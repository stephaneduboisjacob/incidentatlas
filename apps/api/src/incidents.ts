import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { rankEvents } from "@incidentatlas/correlation";
import { EventSchema, type IncidentEvent } from "@incidentatlas/event-schema";
import { z } from "zod";
import { getUserSession } from "./auth.js";
import { inTransaction } from "./database.js";
import { assertCsrf, newId } from "./security.js";

const IncidentCreateSchema = z.object({
  title: z.string().trim().min(1).max(256),
  started_at: z.iso.datetime({ offset: true }),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  affected_services: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
  time_window_before_minutes: z.number().int().min(1).max(10_080).default(60),
  time_window_after_minutes: z.number().int().min(1).max(10_080).default(30),
  summary: z.string().max(10_000).default(""),
}).strict();

const FeedbackSchema = z.object({
  status: z.enum(["investigating", "rejected", "contributing", "confirmed_by_human"]),
  note: z.string().trim().max(2_000).optional(),
}).strict();

const AnnotationSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
  event_id: z.uuid().optional(),
}).strict();

function error(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ error: { code } });
}

function validWrite(request: FastifyRequest, token: string): boolean {
  try {
    assertCsrf(request, token);
    return true;
  } catch {
    return false;
  }
}

function toEvent(row: Record<string, unknown>): IncidentEvent | undefined {
  const value = EventSchema.safeParse({
    schema_version: 1,
    event_id: row.id,
    occurred_at: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at,
    observed_at: row.observed_at instanceof Date ? row.observed_at.toISOString() : row.observed_at,
    source: row.source,
    category: row.category,
    type: row.event_type,
    severity: row.severity,
    change_kind: row.change_kind,
    ...(row.actor && typeof row.actor === "object" ? { actor: row.actor } : {}),
    resource: row.resource,
    summary: row.summary,
    before: row.before_state,
    after: row.after_state,
    attributes: row.attributes,
    evidence: row.evidence,
    ...(row.correlation && typeof row.correlation === "object" ? { correlation: row.correlation } : {}),
    privacy: { redaction_applied: true, redaction_ruleset: row.redaction_ruleset },
  });
  return value.success ? value.data : undefined;
}

export function registerIncidentRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/v1/incidents", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const result = await pool.query(
      `SELECT id, title, status, severity, started_at, detected_at, resolved_at, affected_services, summary, created_at
         FROM incidents WHERE organization_id = $1 ORDER BY started_at DESC LIMIT 200`,
      [session.user.organizationId],
    );
    return { incidents: result.rows };
  });

  app.post("/api/v1/incidents", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (session.user.role === "read_only") return error(reply, 403, "permission_denied");
    if (!validWrite(request, session.token)) return error(reply, 403, "csrf_invalid");
    const parsed = IncidentCreateSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_incident");
    const incidentId = newId();
    const result = await inTransaction(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO incidents (id, organization_id, title, status, severity, started_at, detected_at,
                                time_window_before, time_window_after, affected_services, summary, created_by)
         VALUES ($1, $2, $3, 'open', $4, $5, now(), $6 * interval '1 minute', $7 * interval '1 minute', $8::jsonb, $9, $10)
         RETURNING id, title, status, severity, started_at, detected_at, affected_services, summary, created_at`,
        [incidentId, session.user.organizationId, parsed.data.title, parsed.data.severity, parsed.data.started_at,
          parsed.data.time_window_before_minutes, parsed.data.time_window_after_minutes,
          JSON.stringify(parsed.data.affected_services), parsed.data.summary, session.user.id],
      );
      await client.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id)
         VALUES ($1, $2, $3, 'incident.created', 'incident', $4)`,
        [newId(), session.user.organizationId, session.user.id, incidentId],
      );
      return inserted.rows[0];
    });
    return reply.code(201).send({ incident: result });
  });

  app.get<{ Params: { id: string } }>("/api/v1/incidents/:id/timeline", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const incidentId = z.uuid().safeParse(request.params.id);
    if (!incidentId.success) return error(reply, 400, "invalid_incident_id");
    const incidentResult = await pool.query<{
      id: string; title: string; started_at: Date; time_window_before: string; time_window_after: string;
      affected_services: string[]; status: string; severity: string;
    }>(
      `SELECT id, title, started_at, extract(epoch from time_window_before) / 60 AS time_window_before,
              extract(epoch from time_window_after) / 60 AS time_window_after, affected_services, status, severity
         FROM incidents WHERE organization_id = $1 AND id = $2`,
      [session.user.organizationId, incidentId.data],
    );
    const incident = incidentResult.rows[0];
    if (!incident) return error(reply, 404, "incident_not_found");
    const eventsResult = await pool.query(
      `SELECT e.id, e.host_id, e.occurred_at, e.observed_at, e.ingested_at, e.source, e.category,
              e.event_type, e.severity, e.change_kind, e.actor, e.resource, e.summary,
              e.before_state, e.after_state, e.attributes, e.evidence, e.correlation,
              e.redaction_ruleset, e.event_digest
         FROM events e
        WHERE e.organization_id = $1
          AND e.occurred_at BETWEEN ($2::timestamptz - $3::interval) AND ($2::timestamptz + $4::interval)
        ORDER BY e.occurred_at ASC, e.id ASC LIMIT 2000`,
      [session.user.organizationId, incident.started_at, `${incident.time_window_before} minutes`, `${incident.time_window_after} minutes`],
    );
    const parsedEvents = eventsResult.rows.map((row) => ({ row, event: toEvent(row as Record<string, unknown>) })).filter((entry): entry is { row: typeof entry.row; event: IncidentEvent } => Boolean(entry.event));
    const ranked = rankEvents(parsedEvents.map(({ event }) => event), {
      id: incident.id,
      startedAt: incident.started_at.toISOString(),
      windowBeforeMinutes: Number(incident.time_window_before),
      windowAfterMinutes: Number(incident.time_window_after),
      affectedServices: incident.affected_services,
    });
    const rankedById = new Map(ranked.map((score) => [score.eventId, score]));
    return {
      incident,
      events: parsedEvents.map(({ row, event }) => ({ ...row, correlation: rankedById.get(event.event_id) })),
    };
  });

  app.post<{ Params: { id: string } }>("/api/v1/incidents/:id/hypotheses/generate", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (session.user.role === "read_only") return error(reply, 403, "permission_denied");
    if (!validWrite(request, session.token)) return error(reply, 403, "csrf_invalid");
    const incidentId = z.uuid().safeParse(request.params.id);
    if (!incidentId.success) return error(reply, 400, "invalid_incident_id");
    const timeline = await pool.query<{ id: string; title: string; started_at: Date; time_window_before: string; time_window_after: string; affected_services: string[] }>(
      `SELECT id, title, started_at, extract(epoch from time_window_before) / 60 AS time_window_before,
              extract(epoch from time_window_after) / 60 AS time_window_after, affected_services
         FROM incidents WHERE organization_id = $1 AND id = $2`,
      [session.user.organizationId, incidentId.data],
    );
    const incident = timeline.rows[0];
    if (!incident) return error(reply, 404, "incident_not_found");
    const events = await pool.query(
      `SELECT e.id, e.occurred_at, e.observed_at, e.source, e.category, e.event_type, e.severity,
              e.change_kind, e.actor, e.resource, e.summary, e.before_state, e.after_state,
              e.attributes, e.evidence, e.correlation, e.redaction_ruleset
         FROM events e WHERE e.organization_id = $1
          AND e.occurred_at BETWEEN ($2::timestamptz - $3::interval) AND ($2::timestamptz + $4::interval)
        ORDER BY e.occurred_at ASC, e.id ASC LIMIT 2000`,
      [session.user.organizationId, incident.started_at, `${incident.time_window_before} minutes`, `${incident.time_window_after} minutes`],
    );
    const parsedEvents = events.rows.map((row) => toEvent(row as Record<string, unknown>)).filter((event): event is IncidentEvent => Boolean(event));
    const candidates = rankEvents(parsedEvents, {
      id: incident.id,
      startedAt: incident.started_at.toISOString(),
      windowBeforeMinutes: Number(incident.time_window_before),
      windowAfterMinutes: Number(incident.time_window_after),
      affectedServices: incident.affected_services,
    }).filter((score) => score.relationship === "supporting" && score.score >= 45).slice(0, 10);
    const eventById = new Map(parsedEvents.map((event) => [event.event_id, event]));
    const created = await inTransaction(pool, async (client) => {
      const output: Array<{ id: string; title: string; confidence: number }> = [];
      for (const candidate of candidates) {
        const event = eventById.get(candidate.eventId);
        if (!event) continue;
        const hypothesisId = newId();
        const explanation = candidate.factors.filter((factor) => factor.points > 0).map((factor) => factor.explanation).join(" ");
        const confidence = Math.min(1, candidate.score / 100);
        const title = `${event.summary} may be related`;
        const inserted = await client.query(
          `INSERT INTO hypotheses (id, organization_id, incident_id, title, description, status, generated_by, confidence, source_event_id)
           VALUES ($1, $2, $3, $4, $5, 'suggested', 'deterministic', $6, $7)
           ON CONFLICT DO NOTHING RETURNING id`,
          [hypothesisId, session.user.organizationId, incident.id, title, explanation, confidence, event.event_id],
        );
        if (!inserted.rows[0]) continue;
        await client.query(
          `INSERT INTO hypothesis_evidence (organization_id, hypothesis_id, event_id, relationship, weight, explanation)
           VALUES ($1, $2, $3, 'supporting', $4, $5)`,
          [session.user.organizationId, hypothesisId, event.event_id, candidate.score, explanation],
        );
        output.push({ id: hypothesisId, title, confidence });
      }
      if (output.length) {
        await client.query(
          `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, attributes)
           VALUES ($1, $2, $3, 'hypothesis.generated', 'incident', $4, $5::jsonb)`,
          [newId(), session.user.organizationId, session.user.id, incident.id, JSON.stringify({ count: output.length, engine: "deterministic-v1" })],
        );
      }
      return output;
    });
    return { hypotheses: created };
  });

  app.get<{ Params: { id: string } }>("/api/v1/incidents/:id/hypotheses", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const incidentId = z.uuid().safeParse(request.params.id);
    if (!incidentId.success) return error(reply, 400, "invalid_incident_id");
    const result = await pool.query(
      `SELECT h.id, h.title, h.description, h.status, h.generated_by, h.confidence, h.created_at,
              COALESCE(jsonb_agg(jsonb_build_object(
                'event_id', he.event_id, 'relationship', he.relationship,
                'weight', he.weight, 'explanation', he.explanation
              )) FILTER (WHERE he.event_id IS NOT NULL), '[]'::jsonb) AS evidence
         FROM hypotheses h LEFT JOIN hypothesis_evidence he
           ON he.organization_id = h.organization_id AND he.hypothesis_id = h.id
        WHERE h.organization_id = $1 AND h.incident_id = $2
        GROUP BY h.id ORDER BY h.created_at DESC`,
      [session.user.organizationId, incidentId.data],
    );
    return { hypotheses: result.rows };
  });

  app.post<{ Params: { id: string; hypothesisId: string } }>("/api/v1/incidents/:id/hypotheses/:hypothesisId/feedback", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (session.user.role === "read_only") return error(reply, 403, "permission_denied");
    if (!validWrite(request, session.token)) return error(reply, 403, "csrf_invalid");
    const params = z.object({ id: z.uuid(), hypothesisId: z.uuid() }).safeParse(request.params);
    const body = FeedbackSchema.safeParse(request.body);
    if (!params.success || !body.success) return error(reply, 400, "invalid_feedback");
    const updated = await inTransaction(pool, async (client) => {
      const result = await client.query(
        `UPDATE hypotheses SET status = $1
          WHERE organization_id = $2 AND incident_id = $3 AND id = $4
          RETURNING id, title, status, generated_by, confidence`,
        [body.data.status, session.user.organizationId, params.data.id, params.data.hypothesisId],
      );
      if (!result.rows[0]) return undefined;
      await client.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, attributes)
         VALUES ($1, $2, $3, $4, 'hypothesis', $5, $6::jsonb)`,
        [newId(), session.user.organizationId, session.user.id, `hypothesis.${body.data.status}`, params.data.hypothesisId, JSON.stringify({ incident_id: params.data.id, note: body.data.note })],
      );
      return result.rows[0];
    });
    if (!updated) return error(reply, 404, "hypothesis_not_found");
    return { hypothesis: updated };
  });

  app.post<{ Params: { id: string } }>("/api/v1/incidents/:id/annotations", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (session.user.role === "read_only") return error(reply, 403, "permission_denied");
    if (!validWrite(request, session.token)) return error(reply, 403, "csrf_invalid");
    const incidentId = z.uuid().safeParse(request.params.id);
    const body = AnnotationSchema.safeParse(request.body);
    if (!incidentId.success || !body.success) return error(reply, 400, "invalid_annotation");
    const annotationId = newId();
    try {
      const result = await inTransaction(pool, async (client) => {
        const inserted = await client.query(
          `INSERT INTO annotations (id, organization_id, incident_id, event_id, user_id, body)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, incident_id, event_id, body, created_at`,
          [annotationId, session.user.organizationId, incidentId.data, body.data.event_id ?? null, session.user.id, body.data.body],
        );
        await client.query(
          `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id)
           VALUES ($1, $2, $3, 'incident.annotation.created', 'incident', $4)`,
          [newId(), session.user.organizationId, session.user.id, incidentId.data],
        );
        return inserted.rows[0];
      });
      return reply.code(201).send({ annotation: result });
    } catch {
      return error(reply, 404, "incident_or_event_not_found");
    }
  });
}

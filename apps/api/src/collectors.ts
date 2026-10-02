import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { inTransaction } from "./database.js";
import { canonicalJson, sha256, safeEqual, newId, assertCsrf } from "./security.js";
import { getUserSession } from "./auth.js";

const DEFAULT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

const RegistrationSchema = z.object({
  enrollment_token: z.string().min(32).max(512),
  hostname: z.string().min(1).max(253).regex(/^[a-zA-Z0-9_.-]+$/),
  machine_id_hash: z.string().regex(/^[a-f0-9]{64}$/),
  operating_system: z.string().min(1).max(128),
  kernel: z.string().max(256).default(""),
  agent_version: z.string().min(1).max(64),
  schema_version: z.literal(1),
}).strict();

function error(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ error: { code } });
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice(7);
  return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}

export interface CollectorIdentity {
  id: string;
  organization_id: string;
  host_id: string;
  agent_version: string;
}

export async function getCollectorIdentity(pool: Pool, request: FastifyRequest): Promise<CollectorIdentity | undefined> {
  const token = bearerToken(request);
  if (!token) return undefined;
  const result = await pool.query<CollectorIdentity>(
    `SELECT id, organization_id, host_id, agent_version FROM collectors
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [sha256(token)],
  );
  return result.rows[0];
}

export function registerCollectorRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/v1/collectors", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const result = await pool.query(
      `SELECT c.id, c.host_id, h.hostname, c.agent_version, c.schema_version,
              c.created_at, c.last_seen_at, c.revoked_at
         FROM collectors c JOIN hosts h
           ON h.organization_id = c.organization_id AND h.id = c.host_id
        WHERE c.organization_id = $1 ORDER BY h.hostname, c.created_at DESC`,
      [session.user.organizationId],
    );
    return { collectors: result.rows };
  });

  app.post<{ Params: { id: string } }>("/api/v1/collectors/:id/revoke", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (!["owner", "admin"].includes(session.user.role)) return error(reply, 403, "permission_denied");
    try {
      assertCsrf(request, session.token);
    } catch {
      return error(reply, 403, "csrf_invalid");
    }
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) return error(reply, 400, "invalid_collector_id");
    const revoked = await inTransaction(pool, async (client) => {
      const result = await client.query(
        `UPDATE collectors SET revoked_at = COALESCE(revoked_at, now())
          WHERE organization_id = $1 AND id = $2
          RETURNING id, host_id, revoked_at`,
        [session.user.organizationId, id.data],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      await client.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id)
         VALUES ($1, $2, $3, 'collector.revoked', 'collector', $4)`,
        [newId(), session.user.organizationId, session.user.id, id.data],
      );
      return row;
    });
    if (!revoked) return error(reply, 404, "collector_not_found");
    return { collector: revoked };
  });

  app.post("/api/v1/collector/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = RegistrationSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_registration");
    const enrollmentToken = process.env.INCIDENTATLAS_ENROLLMENT_TOKEN;
    if (!enrollmentToken || !safeEqual(parsed.data.enrollment_token, enrollmentToken)) return error(reply, 403, "enrollment_rejected");

    const collectorId = newId();
    const hostId = newId();
    const credential = randomBytes(32).toString("base64url");
    try {
      await inTransaction(pool, async (client) => {
        const host = await client.query<{ id: string }>(
          `INSERT INTO hosts (id, organization_id, machine_id_hash, hostname, operating_system, kernel)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (organization_id, machine_id_hash)
           DO UPDATE SET hostname = EXCLUDED.hostname, operating_system = EXCLUDED.operating_system,
                         kernel = EXCLUDED.kernel, last_seen_at = now()
           RETURNING id`,
          [hostId, DEFAULT_ORGANIZATION_ID, parsed.data.machine_id_hash, parsed.data.hostname, parsed.data.operating_system, parsed.data.kernel],
        );
        const actualHostId = host.rows[0]?.id;
        if (!actualHostId) throw new Error("host_registration_failed");
        await client.query(
          `INSERT INTO collectors (id, organization_id, host_id, token_hash, agent_version, schema_version)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [collectorId, DEFAULT_ORGANIZATION_ID, actualHostId, sha256(credential), parsed.data.agent_version, parsed.data.schema_version],
        );
        await client.query(
          `INSERT INTO audit_events (id, organization_id, action, target_type, target_id, attributes)
           VALUES ($1, $2, 'collector.enrolled', 'collector', $3, $4::jsonb)`,
          [newId(), DEFAULT_ORGANIZATION_ID, collectorId, JSON.stringify({ host_id: actualHostId, agent_version: parsed.data.agent_version })],
        );
        return actualHostId;
      });
      const host = await pool.query<{ id: string }>("SELECT host_id AS id FROM collectors WHERE id = $1", [collectorId]);
      return reply.code(201).send({ collector_id: collectorId, host_id: host.rows[0]?.id, credential });
    } catch {
      request.log.error({ event: "collector.registration.failed" });
      return error(reply, 500, "registration_failed");
    }
  });

  app.post("/api/v1/collector/events", { bodyLimit: 1_048_576 }, async (request, reply) => {
    const identity = await getCollectorIdentity(pool, request);
    if (!identity) return error(reply, 401, "collector_authentication_failed");

    const { EventBatchSchema } = await import("@incidentatlas/event-schema");
    const parsed = EventBatchSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_event_batch");
    const now = Date.now();
    if (parsed.data.events.some((event) => Math.abs(now - Date.parse(event.observed_at)) > 7 * 24 * 60 * 60 * 1000)) {
      return error(reply, 400, "collector_clock_out_of_range");
    }

    const artifactIds = [...new Set(parsed.data.events.flatMap((event) => event.evidence.map((reference) => reference.artifact_id)))];
    if (artifactIds.length) {
      const artifacts = await pool.query<{ id: string }>(
        "SELECT id FROM artifacts WHERE organization_id = $1 AND id = ANY($2::uuid[])",
        [identity.organization_id, artifactIds],
      );
      if (artifacts.rowCount !== artifactIds.length) return error(reply, 400, "unknown_evidence_artifact");
    }

    try {
      const result = await inTransaction(pool, async (client) => {
        let inserted = 0;
        let duplicates = 0;
        const newEventIds: string[] = [];
        for (const event of parsed.data.events) {
          const digest = sha256(`${identity.organization_id}\n${identity.host_id}\n${canonicalJson(event)}`).toString("hex");
          const created = await client.query(
            `INSERT INTO events (
               id, organization_id, host_id, collector_id, schema_version, occurred_at, observed_at,
               source, category, event_type, severity, change_kind, actor, resource, summary,
               before_state, after_state, attributes, evidence, correlation, redaction_ruleset,
               event_digest, agent_version
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb,
               $15, $16::jsonb, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb, $21, $22, $23
             ) ON CONFLICT (id) DO NOTHING RETURNING id`,
            [
              event.event_id,
              identity.organization_id,
              identity.host_id,
              identity.id,
              event.schema_version,
              event.occurred_at,
              event.observed_at,
              event.source,
              event.category,
              event.type,
              event.severity,
              event.change_kind,
              JSON.stringify(event.actor ?? null),
              JSON.stringify(event.resource),
              event.summary,
              JSON.stringify(event.before),
              JSON.stringify(event.after),
              JSON.stringify(event.attributes),
              JSON.stringify(event.evidence),
              JSON.stringify(event.correlation ?? null),
              event.privacy.redaction_ruleset,
              digest,
              identity.agent_version,
            ],
          );
          if (created.rowCount) {
            inserted += 1;
            newEventIds.push(event.event_id);
          } else {
            const existing = await client.query<{ event_digest: string }>("SELECT event_digest FROM events WHERE id = $1", [event.event_id]);
            if (existing.rows[0]?.event_digest !== digest) throw new Error("event_id_conflict");
            duplicates += 1;
          }
        }
        await client.query("UPDATE collectors SET last_seen_at = now() WHERE id = $1", [identity.id]);
        await client.query("UPDATE hosts SET last_seen_at = now() WHERE id = $1 AND organization_id = $2", [identity.host_id, identity.organization_id]);
        let clockSkewSeconds: number | undefined;
        const maxClockSkew = Math.max(...parsed.data.events.map((event) => Math.abs(now - Date.parse(event.observed_at))));
        if (maxClockSkew > 5 * 60_000) {
          clockSkewSeconds = Math.round(maxClockSkew / 1_000);
          const skewState = await client.query<{ last_clock_skew_event_at: Date | null }>(
            "SELECT last_clock_skew_event_at FROM collectors WHERE id = $1 FOR UPDATE",
            [identity.id],
          );
          const lastSkewEventAt = skewState.rows[0]?.last_clock_skew_event_at;
          const shouldRecordSkew = !lastSkewEventAt || now - lastSkewEventAt.getTime() >= 5 * 60_000;
          if (shouldRecordSkew) {
          const clockEventId = newId();
          const occurredAt = new Date(now).toISOString();
          const clockEvent = {
            schema_version: 1,
            event_id: clockEventId,
            occurred_at: occurredAt,
            observed_at: occurredAt,
            source: "collector",
            category: "collector",
            type: "collector.clock_skew",
            severity: "warning",
            change_kind: "anomaly",
            resource: { type: "collector", id: identity.id },
            summary: "Collector clock differs from the server clock",
            before: {},
            after: { skew_seconds: clockSkewSeconds },
            attributes: { skew_seconds: clockSkewSeconds },
            evidence: [],
            privacy: { redaction_applied: true, redaction_ruleset: "server-generated-v1" },
          } as const;
          const createdClockEvent = await client.query(
            `INSERT INTO events (
               id, organization_id, host_id, collector_id, schema_version, occurred_at, observed_at,
               source, category, event_type, severity, change_kind, resource, summary, before_state,
               after_state, attributes, evidence, redaction_ruleset, event_digest, agent_version
             ) VALUES ($1, $2, $3, $4, 1, $5, $5, 'collector', 'collector', 'collector.clock_skew', 'warning',
                       'anomaly', $6::jsonb, $7, '{}'::jsonb, $8::jsonb, $8::jsonb, '[]'::jsonb,
                       'server-generated-v1', $9, $10)
             ON CONFLICT (id) DO NOTHING RETURNING id`,
            [clockEventId, identity.organization_id, identity.host_id, identity.id, occurredAt,
              JSON.stringify(clockEvent.resource), clockEvent.summary, JSON.stringify(clockEvent.after),
              sha256(`${identity.organization_id}\n${identity.host_id}\n${canonicalJson(clockEvent)}`).toString("hex"), identity.agent_version],
          );
          if (createdClockEvent.rowCount) newEventIds.push(clockEventId);
          await client.query("UPDATE collectors SET last_clock_skew_event_at = now() WHERE id = $1", [identity.id]);
          }
        }
        if (newEventIds.length) {
          await client.query(
            `INSERT INTO jobs (organization_id, job_type, payload)
             SELECT i.organization_id, 'correlation.rebuild', jsonb_build_object('incident_id', i.id)
               FROM incidents i
              WHERE i.organization_id = $1 AND i.status IN ('open', 'investigating', 'mitigated')
                AND EXISTS (
                  SELECT 1 FROM events e WHERE e.organization_id = i.organization_id
                    AND e.id = ANY($2::uuid[])
                    AND e.occurred_at BETWEEN i.started_at - i.time_window_before AND i.started_at + i.time_window_after
                )
             ON CONFLICT DO NOTHING`,
            [identity.organization_id, newEventIds],
          );
        }
        return { inserted, duplicates, ...(clockSkewSeconds ? { clockSkewSeconds } : {}) };
      });
      return reply.code(202).send({ accepted: result.inserted, duplicates: result.duplicates, ...(result.clockSkewSeconds ? { clock_skew_seconds: result.clockSkewSeconds } : {}) });
    } catch (caught) {
      if (caught instanceof Error && caught.message === "event_id_conflict") return error(reply, 409, "event_id_conflict");
      request.log.error({ event: "collector.ingestion.failed", collector_id: identity.id });
      return error(reply, 503, "ingestion_unavailable");
    }
  });
}

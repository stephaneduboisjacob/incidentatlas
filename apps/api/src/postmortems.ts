import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { getUserSession } from "./auth.js";
import { inTransaction } from "./database.js";
import { assertCsrf, newId } from "./security.js";

type EventRecord = {
  id: string;
  occurred_at: Date;
  source: string;
  category: string;
  summary: string;
  event_digest: string;
};

type HypothesisRecord = {
  id: string;
  title: string;
  description: string;
  status: string;
  event_ids: string[];
};

function error(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ error: { code } });
}

function markdownText(value: string): string {
  const escaped = [...value].reduce((result, character) => {
    return "\\`*_{}[]()#+-.!|>".includes(character) ? `${result}\\${character}` : `${result}${character}`;
  }, "");
  return escaped.replaceAll("<", "&lt;").replaceAll(">", "&gt;").replace(/\s+/g, " ").trim();
}

function evidenceReferences(eventIds: string[]): string {
  return eventIds.length ? eventIds.map((id) => `\`${id}\``).join(", ") : "no event evidence linked";
}

export function registerPostmortemRoutes(app: FastifyInstance, pool: Pool): void {
  app.post<{ Params: { id: string } }>("/api/v1/incidents/:id/postmortem", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (session.user.role === "read_only") return error(reply, 403, "permission_denied");
    try {
      assertCsrf(request, session.token);
    } catch {
      return error(reply, 403, "csrf_invalid");
    }
    const incidentId = z.uuid().safeParse(request.params.id);
    if (!incidentId.success) return error(reply, 400, "invalid_incident_id");

    const incidentResult = await pool.query<{
      id: string;
      title: string;
      status: string;
      severity: string;
      summary: string;
      started_at: Date;
      detected_at: Date;
      resolved_at: Date | null;
      time_window_before: string;
      time_window_after: string;
    }>(
      `SELECT id, title, status, severity, summary, started_at, detected_at, resolved_at,
              extract(epoch from time_window_before) / 60 AS time_window_before,
              extract(epoch from time_window_after) / 60 AS time_window_after
         FROM incidents WHERE organization_id = $1 AND id = $2`,
      [session.user.organizationId, incidentId.data],
    );
    const incident = incidentResult.rows[0];
    if (!incident) return error(reply, 404, "incident_not_found");

    const [eventResult, hypothesisResult] = await Promise.all([
      pool.query<EventRecord>(
        `SELECT id, occurred_at, source, category, summary, event_digest
           FROM events WHERE organization_id = $1
            AND occurred_at BETWEEN ($2::timestamptz - $3::interval) AND ($2::timestamptz + $4::interval)
          ORDER BY occurred_at ASC, id ASC LIMIT 2000`,
        [session.user.organizationId, incident.started_at, `${incident.time_window_before} minutes`, `${incident.time_window_after} minutes`],
      ),
      pool.query<HypothesisRecord>(
        `SELECT h.id, h.title, h.description, h.status,
                COALESCE(array_agg(he.event_id::text ORDER BY he.event_id) FILTER (WHERE he.event_id IS NOT NULL), ARRAY[]::text[]) AS event_ids
           FROM hypotheses h LEFT JOIN hypothesis_evidence he
             ON he.organization_id = h.organization_id AND he.hypothesis_id = h.id
          WHERE h.organization_id = $1 AND h.incident_id = $2
          GROUP BY h.id ORDER BY h.created_at ASC, h.id ASC`,
        [session.user.organizationId, incident.id],
      ),
    ]);

    const events = eventResult.rows;
    const hypotheses = hypothesisResult.rows;
    const confirmed = hypotheses.filter((hypothesis) => hypothesis.status === "confirmed_by_human");
    const rejected = hypotheses.filter((hypothesis) => hypothesis.status === "rejected");
    const unresolved = hypotheses.filter((hypothesis) => ["suggested", "investigating", "contributing"].includes(hypothesis.status));
    const markdown = [
      `# ${markdownText(incident.title)}`,
      "",
      "**Draft:** deterministic template; review every section before sharing.",
      `**Incident record:** \`${incident.id}\` · **Severity:** ${markdownText(incident.severity)} · **Status:** ${markdownText(incident.status)}`,
      "",
      "## Summary",
      incident.summary ? markdownText(incident.summary) : "_Not recorded._",
      "",
      "## Customer impact",
      "_Not recorded._",
      "",
      "## Detection",
      `Incident start recorded at ${incident.started_at.toISOString()} and declared at ${incident.detected_at.toISOString()} [incident: \`${incident.id}\`].`,
      "",
      "## Timeline",
      ...(events.length
        ? events.map((event) => `- ${event.occurred_at.toISOString()} — ${markdownText(event.summary)} (${markdownText(event.source)}/${markdownText(event.category)}; event: \`${event.id}\`)`)
        : ["_No events were captured in this incident window._"]),
      "",
      "## Confirmed contributing factors",
      ...(confirmed.length
        ? confirmed.map((hypothesis) => `- **${markdownText(hypothesis.title)}** — ${markdownText(hypothesis.description)} [human feedback: \`${hypothesis.id}\`; evidence: ${evidenceReferences(hypothesis.event_ids)}]`)
        : ["_No hypothesis has been confirmed by a human._"]),
      "",
      "## Investigated but rejected hypotheses",
      ...(rejected.length
        ? rejected.map((hypothesis) => `- **${markdownText(hypothesis.title)}** — ${markdownText(hypothesis.description)} [human feedback: \`${hypothesis.id}\`; evidence: ${evidenceReferences(hypothesis.event_ids)}]`)
        : ["_None recorded._"]),
      "",
      "## Other hypotheses needing review",
      ...(unresolved.length
        ? unresolved.map((hypothesis) => `- **${markdownText(hypothesis.title)}** (${markdownText(hypothesis.status)}) — ${markdownText(hypothesis.description)} [hypothesis: \`${hypothesis.id}\`; evidence: ${evidenceReferences(hypothesis.event_ids)}]`)
        : ["_None recorded._"]),
      "",
      "## Resolution",
      incident.resolved_at
        ? `Incident marked ${markdownText(incident.status)} at ${incident.resolved_at.toISOString()} [incident: \`${incident.id}\`].`
        : `Incident is currently marked ${markdownText(incident.status)} [incident: \`${incident.id}\`].`,
      "",
      "## Evidence",
      ...(events.length
        ? events.map((event) => `- Event \`${event.id}\` · SHA-256 \`${event.event_digest}\` · ${markdownText(event.source)}/${markdownText(event.category)}`)
        : ["_No event evidence is available._"]),
      "",
      "## Corrective actions",
      "_Not recorded._",
      "",
      "## Follow-up items",
      "_Not recorded._",
      "",
      "---",
      "Generated from IncidentAtlas records by deterministic-template-v1. Timeline statements reference event IDs; only hypotheses marked by a human as confirmed appear under confirmed contributing factors.",
      "",
    ].join("\n");

    await inTransaction(pool, async (client) => {
      await client.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, attributes)
         VALUES ($1, $2, $3, 'postmortem.generated', 'incident', $4, $5::jsonb)`,
        [newId(), session.user.organizationId, session.user.id, incident.id,
          JSON.stringify({ generator: "deterministic-template-v1", event_count: events.length, confirmed_hypothesis_count: confirmed.length })],
      );
    });

    return { markdown, generator: "deterministic-template-v1", source_event_ids: events.map((event) => event.id) };
  });
}

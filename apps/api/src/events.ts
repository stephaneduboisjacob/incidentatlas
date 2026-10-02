import type { FastifyInstance, FastifyReply } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { getUserSession } from "./auth.js";

const ListQuery = z.object({
  host_id: z.uuid().optional(),
  before: z.iso.datetime({ offset: true }).optional(),
  after: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
}).strict();

function error(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ error: { code } });
}

export function registerEventRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/v1/hosts", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const result = await pool.query(
      `SELECT h.id, h.hostname, h.operating_system, h.kernel, h.first_seen_at, h.last_seen_at,
              count(e.id)::int AS event_count
         FROM hosts h LEFT JOIN events e ON e.organization_id = h.organization_id AND e.host_id = h.id
        WHERE h.organization_id = $1
        GROUP BY h.id ORDER BY h.hostname`,
      [session.user.organizationId],
    );
    return { hosts: result.rows };
  });

  app.get("/api/v1/events", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const parsed = ListQuery.safeParse(request.query);
    if (!parsed.success) return error(reply, 400, "invalid_query");
    const { host_id: hostId, before, after, limit } = parsed.data;
    const values: unknown[] = [session.user.organizationId];
    const predicates = ["organization_id = $1"];
    if (hostId) {
      values.push(hostId);
      predicates.push(`host_id = $${values.length}`);
    }
    if (after) {
      values.push(after);
      predicates.push(`occurred_at >= $${values.length}`);
    }
    if (before) {
      values.push(before);
      predicates.push(`occurred_at <= $${values.length}`);
    }
    values.push(limit);
    const result = await pool.query(
      `SELECT id, host_id, occurred_at, observed_at, ingested_at, source, category, event_type,
              severity, change_kind, actor, resource, summary, before_state, after_state,
              attributes, evidence, correlation, event_digest
         FROM events WHERE ${predicates.join(" AND ")}
        ORDER BY occurred_at DESC, id LIMIT $${values.length}`,
      values,
    );
    return { events: result.rows };
  });

  app.get<{ Params: { id: string } }>("/api/v1/events/:id", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const id = z.uuid().safeParse(request.params.id);
    if (!id.success) return error(reply, 400, "invalid_event_id");
    const result = await pool.query(
      `SELECT id, host_id, collector_id, schema_version, occurred_at, observed_at, ingested_at,
              source, category, event_type, severity, change_kind, actor, resource, summary,
              before_state, after_state, attributes, evidence, correlation, redaction_ruleset,
              event_digest, agent_version
         FROM events WHERE organization_id = $1 AND id = $2`,
      [session.user.organizationId, id.data],
    );
    const event = result.rows[0];
    if (!event) return error(reply, 404, "event_not_found");
    return { event };
  });
}

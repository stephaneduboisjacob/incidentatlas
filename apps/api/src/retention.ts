import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { getUserSession } from "./auth.js";
import { inTransaction } from "./database.js";
import { assertCsrf, newId } from "./security.js";

const PolicySchema = z.object({
  event_days: z.number().int().min(1).max(3650),
  artifact_days: z.number().int().min(1).max(3650),
  audit_days: z.number().int().min(1).max(3650),
  ai_generation_days: z.number().int().min(1).max(3650),
  confirm_immediate_expiry: z.boolean().default(false),
}).strict();
const HoldSchema = z.object({ incident_id: z.uuid().optional(), reason: z.string().trim().min(1).max(2000) }).strict();
const ReleaseSchema = z.object({ reason: z.string().trim().min(1).max(2000) }).strict();

function error(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ error: { code } });
}

function csrfValid(request: FastifyRequest, token: string): boolean {
  try { assertCsrf(request, token); return true; } catch { return false; }
}

function canAdminister(role: string): boolean {
  return role === "owner" || role === "admin";
}

export function registerRetentionRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/v1/settings/retention", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const result = await pool.query(
      `SELECT event_days, artifact_days, audit_days, ai_generation_days, updated_at
         FROM retention_policies WHERE organization_id = $1`,
      [session.user.organizationId],
    );
    return { policy: result.rows[0] ?? { event_days: 90, artifact_days: 30, audit_days: 365, ai_generation_days: 30 } };
  });

  app.put("/api/v1/settings/retention", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (!canAdminister(session.user.role)) return error(reply, 403, "permission_denied");
    if (!csrfValid(request, session.token)) return error(reply, 403, "csrf_invalid");
    const parsed = PolicySchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_retention_policy");
    const result = await inTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 912843))", [`retention:${session.user.organizationId}`]);
      const existing = await client.query<{ event_days: number; artifact_days: number; audit_days: number; ai_generation_days: number }>(
        "SELECT event_days, artifact_days, audit_days, ai_generation_days FROM retention_policies WHERE organization_id = $1 FOR UPDATE",
        [session.user.organizationId],
      );
      const current = existing.rows[0] ?? { event_days: 90, artifact_days: 30, audit_days: 365, ai_generation_days: 30 };
      const shorter = parsed.data.event_days < current.event_days || parsed.data.artifact_days < current.artifact_days
        || parsed.data.audit_days < current.audit_days || parsed.data.ai_generation_days < current.ai_generation_days;
      if (shorter && !parsed.data.confirm_immediate_expiry) return { requiresConfirmation: true as const };
      const result = await client.query(
        `INSERT INTO retention_policies (organization_id, event_days, artifact_days, audit_days, ai_generation_days, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (organization_id) DO UPDATE SET event_days = EXCLUDED.event_days,
           artifact_days = EXCLUDED.artifact_days, audit_days = EXCLUDED.audit_days,
           ai_generation_days = EXCLUDED.ai_generation_days, updated_at = now()
         RETURNING event_days, artifact_days, audit_days, ai_generation_days, updated_at`,
        [session.user.organizationId, parsed.data.event_days, parsed.data.artifact_days, parsed.data.audit_days, parsed.data.ai_generation_days],
      );
      await client.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, attributes)
         VALUES ($1, $2, $3, 'retention.updated', 'organization', $4::jsonb)`,
        [newId(), session.user.organizationId, session.user.id, JSON.stringify({
          event_days: parsed.data.event_days,
          artifact_days: parsed.data.artifact_days,
          audit_days: parsed.data.audit_days,
          ai_generation_days: parsed.data.ai_generation_days,
          immediate_expiry_confirmed: shorter,
        })],
      );
      await client.query(
        `INSERT INTO jobs (organization_id, job_type, payload) VALUES ($1, 'retention.sweep', '{}'::jsonb)
         ON CONFLICT (organization_id) WHERE job_type = 'retention.sweep' AND state IN ('queued', 'running') DO NOTHING`,
        [session.user.organizationId],
      );
      return { requiresConfirmation: false as const, policy: result.rows[0] };
    });
    if (result.requiresConfirmation) return reply.code(409).send({ error: { code: "retention_reduction_confirmation_required" } });
    return { policy: result.policy };
  });

  app.get("/api/v1/legal-holds", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    const result = await pool.query(
      `SELECT h.id, h.incident_id, i.title AS incident_title, h.reason, h.created_at,
              h.created_by, h.released_at, h.released_by, h.release_reason
         FROM legal_holds h LEFT JOIN incidents i ON i.organization_id = h.organization_id AND i.id = h.incident_id
        WHERE h.organization_id = $1 ORDER BY h.created_at DESC LIMIT 500`,
      [session.user.organizationId],
    );
    return { legal_holds: result.rows };
  });

  app.post("/api/v1/legal-holds", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (!canAdminister(session.user.role)) return error(reply, 403, "permission_denied");
    if (!csrfValid(request, session.token)) return error(reply, 403, "csrf_invalid");
    const parsed = HoldSchema.safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_legal_hold");
    const id = newId();
    const result = await inTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 912843))", [`retention:${session.user.organizationId}`]);
      if (parsed.data.incident_id) {
        const incident = await client.query("SELECT 1 FROM incidents WHERE organization_id = $1 AND id = $2", [session.user.organizationId, parsed.data.incident_id]);
        if (!incident.rowCount) return undefined;
      }
      await client.query(
        `INSERT INTO legal_holds (id, organization_id, incident_id, reason, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, session.user.organizationId, parsed.data.incident_id ?? null, parsed.data.reason, session.user.id],
      );
      await client.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, attributes)
         VALUES ($1, $2, $3, 'legal_hold.enabled', 'legal_hold', $4, $5::jsonb)`,
        [newId(), session.user.organizationId, session.user.id, id, JSON.stringify({ incident_id: parsed.data.incident_id ?? null, reason: parsed.data.reason })],
      );
      return { id, incident_id: parsed.data.incident_id ?? null, reason: parsed.data.reason };
    });
    if (!result) return error(reply, 404, "incident_not_found");
    return reply.code(201).send({ legal_hold: result });
  });

  app.post<{ Params: { id: string } }>("/api/v1/legal-holds/:id/release", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    if (!canAdminister(session.user.role)) return error(reply, 403, "permission_denied");
    if (!csrfValid(request, session.token)) return error(reply, 403, "csrf_invalid");
    const id = z.uuid().safeParse(request.params.id);
    const parsed = ReleaseSchema.safeParse(request.body);
    if (!id.success || !parsed.success) return error(reply, 400, "invalid_legal_hold_release");
    const released = await inTransaction(pool, async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 912843))", [`retention:${session.user.organizationId}`]);
      const updated = await client.query(
        `UPDATE legal_holds SET released_at = now(), released_by = $3, release_reason = $4
          WHERE organization_id = $1 AND id = $2 AND released_at IS NULL RETURNING id, incident_id`,
        [session.user.organizationId, id.data, session.user.id, parsed.data.reason],
      );
      if (!updated.rows[0]) return false;
      await client.query(
        `INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id, attributes)
         VALUES ($1, $2, $3, 'legal_hold.released', 'legal_hold', $4, $5::jsonb)`,
        [newId(), session.user.organizationId, session.user.id, id.data, JSON.stringify({ incident_id: updated.rows[0].incident_id, reason: parsed.data.reason })],
      );
      return true;
    });
    if (!released) return error(reply, 404, "active_legal_hold_not_found");
    return { ok: true };
  });
}

import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { inTransaction } from "./database.js";
import { requiredEnv } from "./env.js";
import {
  assertCsrf,
  assertRequestOrigin,
  clearSessionCookie,
  createSessionToken,
  csrfToken,
  hashPassword,
  newId,
  readSessionCookie,
  safeEqual,
  sessionCookie,
  sha256,
  verifyPassword,
} from "./security.js";

const DEFAULT_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_HOURS = 12;

export interface UserSession {
  id: string;
  email: string;
  displayName: string;
  organizationId: string;
  role: string;
}

export async function getUserSession(pool: Pool, request: FastifyRequest): Promise<{ token: string; user: UserSession } | undefined> {
  const token = readSessionCookie(request);
  if (!token) return undefined;
  const result = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    organization_id: string;
    role: string;
  }>(
    `SELECT u.id, u.email, u.display_name, m.organization_id, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.disabled_at IS NULL
       JOIN organization_memberships m ON m.user_id = u.id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
      ORDER BY (m.role = 'owner') DESC, m.organization_id
      LIMIT 1`,
    [sha256(token)],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    token,
    user: { id: row.id, email: row.email, displayName: row.display_name, organizationId: row.organization_id, role: row.role },
  };
}

function error(reply: FastifyReply, status: number, code: string): FastifyReply {
  return reply.code(status).send({ error: { code } });
}

function assertOriginOrThrow(request: FastifyRequest): boolean {
  try {
    assertRequestOrigin(request);
    return true;
  } catch {
    return false;
  }
}

function checkCsrf(request: FastifyRequest, token: string): boolean {
  try {
    assertCsrf(request, token);
    return true;
  } catch {
    return false;
  }
}

async function createSession(client: PoolClient, userId: string): Promise<string> {
  const token = createSessionToken();
  await client.query(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '12 hours')",
    [randomUUID(), userId, sha256(token)],
  );
  return token;
}

function sendSession(reply: FastifyReply, token: string, user: UserSession): FastifyReply {
  return reply.header("set-cookie", sessionCookie(token)).send({
    user: { id: user.id, email: user.email, display_name: user.displayName, role: user.role },
    csrf_token: csrfToken(token),
    expires_in_seconds: SESSION_HOURS * 60 * 60,
  });
}

async function writeAudit(client: PoolClient, organizationId: string, userId: string, action: string, targetType: string, targetId: string): Promise<void> {
  await client.query(
    "INSERT INTO audit_events (id, organization_id, actor_user_id, action, target_type, target_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [newId(), organizationId, userId, action, targetType, targetId],
  );
}

export function registerAuthRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/api/v1/auth/status", async () => {
    const result = await pool.query<{ has_users: boolean }>("SELECT EXISTS (SELECT 1 FROM users) AS has_users");
    return { initialized: result.rows[0]?.has_users ?? false, setup_available: Boolean(process.env.INCIDENTATLAS_SETUP_TOKEN) };
  });

  app.post("/api/v1/auth/setup", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!assertOriginOrThrow(request)) return error(reply, 403, "origin_mismatch");
    const parsed = z.object({
      setup_token: z.string().min(32).max(512),
      organization_name: z.string().trim().min(1).max(128),
      email: z.email().max(320).transform((email) => email.toLowerCase()),
      display_name: z.string().trim().min(1).max(128),
      password: z.string().min(12).max(256),
    }).strict().safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_request");
    const configuredToken = process.env.INCIDENTATLAS_SETUP_TOKEN;
    if (!configuredToken || !safeEqual(parsed.data.setup_token, configuredToken)) return error(reply, 403, "setup_unavailable");

    try {
      const passwordHash = await hashPassword(parsed.data.password);
      const userId = newId();
      const result = await inTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(726310291)");
        const existing = await client.query("SELECT 1 FROM users LIMIT 1");
        if (existing.rowCount) return undefined;
        await client.query("UPDATE organizations SET name = $1 WHERE id = $2", [parsed.data.organization_name, DEFAULT_ORGANIZATION_ID]);
        await client.query(
          "INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, $3, $4)",
          [userId, parsed.data.email, passwordHash, parsed.data.display_name],
        );
        await client.query(
          "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
          [DEFAULT_ORGANIZATION_ID, userId],
        );
        await writeAudit(client, DEFAULT_ORGANIZATION_ID, userId, "user.initialized", "user", userId);
        const token = await createSession(client, userId);
        return { token, user: { id: userId, email: parsed.data.email, displayName: parsed.data.display_name, organizationId: DEFAULT_ORGANIZATION_ID, role: "owner" } satisfies UserSession };
      });
      if (!result) return error(reply, 409, "already_initialized");
      return sendSession(reply.code(201), result.token, result.user);
    } catch (caught) {
      if ((caught as { code?: string }).code === "23505") return error(reply, 409, "account_exists");
      request.log.error({ event: "auth.setup.failed" });
      return error(reply, 500, "setup_failed");
    }
  });

  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!assertOriginOrThrow(request)) return error(reply, 403, "origin_mismatch");
    const parsed = z.object({ email: z.email().max(320).transform((email) => email.toLowerCase()), password: z.string().min(1).max(256) }).strict().safeParse(request.body);
    if (!parsed.success) return error(reply, 400, "invalid_request");

    const account = await pool.query<{ id: string; email: string; password_hash: string; display_name: string; organization_id: string; role: string }>(
      `SELECT u.id, u.email, u.password_hash, u.display_name, m.organization_id, m.role
         FROM users u JOIN organization_memberships m ON m.user_id = u.id
        WHERE u.email = $1 AND u.disabled_at IS NULL
        ORDER BY (m.role = 'owner') DESC, m.organization_id LIMIT 1`,
      [parsed.data.email],
    );
    const row = account.rows[0];
    if (!row) {
      await hashPassword(parsed.data.password);
      return error(reply, 401, "invalid_credentials");
    }
    if (!(await verifyPassword(parsed.data.password, row.password_hash))) return error(reply, 401, "invalid_credentials");

    try {
      const token = await inTransaction(pool, async (client) => {
        const sessionToken = await createSession(client, row.id);
        await writeAudit(client, row.organization_id, row.id, "user.login", "user", row.id);
        return sessionToken;
      });
      return sendSession(reply, token, { id: row.id, email: row.email, displayName: row.display_name, organizationId: row.organization_id, role: row.role });
    } catch {
      request.log.error({ event: "auth.login.failed" });
      return error(reply, 500, "login_failed");
    }
  });

  app.get("/api/v1/auth/me", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) return error(reply, 401, "authentication_required");
    return {
      user: { id: session.user.id, email: session.user.email, display_name: session.user.displayName, role: session.user.role },
      csrf_token: csrfToken(session.token),
      expires_in_seconds: SESSION_HOURS * 60 * 60,
    };
  });

  app.post("/api/v1/auth/logout", async (request, reply) => {
    const session = await getUserSession(pool, request);
    if (!session) {
      reply.header("set-cookie", clearSessionCookie());
      return error(reply, 401, "authentication_required");
    }
    if (!checkCsrf(request, session.token)) return error(reply, 403, "csrf_invalid");
    await inTransaction(pool, async (client) => {
      await client.query("UPDATE sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL", [sha256(session.token)]);
      await writeAudit(client, session.user.organizationId, session.user.id, "user.logout", "user", session.user.id);
    });
    return reply.header("set-cookie", clearSessionCookie()).send({ ok: true });
  });
}

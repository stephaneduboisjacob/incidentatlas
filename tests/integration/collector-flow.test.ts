import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import dotenv from "dotenv";
import { Pool } from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(root, ".env"), quiet: true });
const envFile = await readFile(resolve(root, ".env"), "utf8").catch(() => "");
const postgresqlPassword = envFile.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1];
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? (postgresqlPassword ? `postgres://incidentatlas:${postgresqlPassword}@127.0.0.1:55432/incidentatlas` : process.env.DATABASE_URL);
if (!databaseUrl) throw new Error("Set TEST_DATABASE_URL or provide the isolated Compose PostgreSQL service");
const testDatabase = new URL(databaseUrl);
if (testDatabase.hostname !== "127.0.0.1" || testDatabase.port !== "55432" || testDatabase.pathname !== "/incidentatlas") {
  throw new Error("Integration tests require the isolated localhost Compose database at 127.0.0.1:55432/incidentatlas");
}

const enrollmentToken = process.env.INCIDENTATLAS_ENROLLMENT_TOKEN;
if (!enrollmentToken) throw new Error("INCIDENTATLAS_ENROLLMENT_TOKEN must be configured for collector integration tests");
const origin = process.env.INCIDENTATLAS_PUBLIC_ORIGIN ?? "http://localhost:5173";
process.env.INCIDENTATLAS_PUBLIC_ORIGIN = origin;
const { createApp } = await import("../../apps/api/src/app.js");
const { csrfToken } = await import("../../apps/api/src/security.js");
const pool = new Pool({ connectionString: databaseUrl, application_name: "incidentatlas-test", max: 4 });
const organizationId = "00000000-0000-4000-8000-000000000001";
const userId = randomUUID();
const sessionId = randomUUID();
let collectorId: string | undefined;
let hostId: string | undefined;
let incidentId: string | undefined;
const eventId = randomUUID();
const sessionToken = randomBytes(32).toString("base64url");
const machineIdHash = createHash("sha256").update(randomUUID()).digest("hex");
const bytes = (value: string): Buffer => createHash("sha256").update(value).digest();
const app = await createApp(pool);

async function seedUser(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, 'integration-test-only', 'Integration Test')", [userId, `${userId}@example.invalid`]);
    await client.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [organizationId, userId]);
    await client.query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [sessionId, userId, bytes(sessionToken)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup(): Promise<void> {
  const targets = [collectorId, incidentId].filter((id): id is string => Boolean(id));
  await pool.query("DELETE FROM audit_events WHERE actor_user_id = $1 OR target_id = ANY($2::uuid[])", [userId, targets]);
  if (incidentId) {
    await pool.query("DELETE FROM jobs WHERE organization_id = $1 AND payload->>'incident_id' = $2", [organizationId, incidentId]);
    await pool.query("DELETE FROM annotations WHERE organization_id = $1 AND incident_id = $2", [organizationId, incidentId]);
    await pool.query("DELETE FROM hypothesis_evidence WHERE organization_id = $1 AND hypothesis_id IN (SELECT id FROM hypotheses WHERE organization_id = $1 AND incident_id = $2)", [organizationId, incidentId]);
    await pool.query("DELETE FROM hypotheses WHERE organization_id = $1 AND incident_id = $2", [organizationId, incidentId]);
    await pool.query("DELETE FROM incidents WHERE organization_id = $1 AND id = $2", [organizationId, incidentId]);
  }
  if (collectorId) {
    await pool.query("DELETE FROM events WHERE organization_id = $1 AND collector_id = $2", [organizationId, collectorId]);
    await pool.query("DELETE FROM collectors WHERE organization_id = $1 AND id = $2", [organizationId, collectorId]);
  }
  if (hostId) await pool.query("DELETE FROM hosts WHERE organization_id = $1 AND id = $2", [organizationId, hostId]);
  await pool.query("DELETE FROM sessions WHERE id = $1", [sessionId]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1 AND user_id = $2", [organizationId, userId]);
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
}

test("collector enrollment, durable event delivery, and incident timeline work end to end", async (context) => {
  context.after(async () => {
    await app.close();
    await cleanup();
    await pool.end();
  });
  await seedUser();

  const missingSecretLikePath = await app.inject({ method: "GET", url: "/.env" });
  assert.equal(missingSecretLikePath.statusCode, 404);
  const missingRepositoryPath = await app.inject({ method: "GET", url: "/.git/HEAD" });
  assert.equal(missingRepositoryPath.statusCode, 404);

  const registration = await app.inject({
    method: "POST",
    url: "/api/v1/collector/register",
    payload: {
      enrollment_token: enrollmentToken,
      hostname: "integration-agent",
      machine_id_hash: machineIdHash,
      operating_system: "test-linux",
      kernel: "test-kernel",
      agent_version: "0.1.0-test",
      schema_version: 1,
    },
  });
  assert.equal(registration.statusCode, 201);
  const credentials = registration.json() as { collector_id: string; host_id: string; credential: string };
  collectorId = credentials.collector_id;
  hostId = credentials.host_id;
  assert.match(credentials.credential, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(credentials.host_id, "");

  const observedAt = new Date();
  const occurredAt = new Date(observedAt.getTime() - 60_000);
  const event = {
    schema_version: 1,
    event_id: eventId,
    occurred_at: occurredAt.toISOString(),
    observed_at: observedAt.toISOString(),
    source: "docker",
    category: "container",
    type: "container.image_changed",
    severity: "warning",
    change_kind: "update",
    actor: { type: "system" },
    resource: { type: "container", id: "api", name: "api" },
    summary: "API image changed before the incident",
    before: { image_digest: "sha256:before" },
    after: { image_digest: "sha256:after", state: "unhealthy" },
    attributes: {},
    evidence: [],
    privacy: { redaction_applied: true, redaction_ruleset: "test-v1" },
  };
  const headers = { authorization: `Bearer ${credentials.credential}` };
  const batch = { schema_version: 1, events: [event] };
  const accepted = await app.inject({ method: "POST", url: "/api/v1/collector/events", headers, payload: batch });
  assert.equal(accepted.statusCode, 202);
  assert.deepEqual(accepted.json(), { accepted: 1, duplicates: 0 });
  const duplicate = await app.inject({ method: "POST", url: "/api/v1/collector/events", headers, payload: batch });
  assert.equal(duplicate.statusCode, 202);
  assert.deepEqual(duplicate.json(), { accepted: 0, duplicates: 1 });
  const conflict = await app.inject({ method: "POST", url: "/api/v1/collector/events", headers, payload: { ...batch, events: [{ ...event, summary: "different body with reused ID" }] } });
  assert.equal(conflict.statusCode, 409);

  const cookie = `ia_session=${sessionToken}`;
  const writeHeaders = { cookie, origin, "x-csrf-token": csrfToken(sessionToken), "content-type": "application/json" };
  const createdIncident = await app.inject({
    method: "POST",
    url: "/api/v1/incidents",
    headers: writeHeaders,
    payload: {
      title: "Docker deployment regression",
      started_at: new Date(observedAt.getTime() + 60_000).toISOString(),
      severity: "high",
      affected_services: ["api"],
      time_window_before_minutes: 10,
      time_window_after_minutes: 5,
    },
  });
  assert.equal(createdIncident.statusCode, 201);
  incidentId = (createdIncident.json() as { incident: { id: string } }).incident.id;
  const timeline = await app.inject({ method: "GET", url: `/api/v1/incidents/${incidentId}/timeline`, headers: { cookie } });
  assert.equal(timeline.statusCode, 200);
  const timelineEvent = (timeline.json().events as Array<{ id: string; correlation: { score: number } }>).find((item) => item.id === eventId);
  assert.ok(timelineEvent);
  assert.ok(timelineEvent.correlation.score >= 45);

  const generated = await app.inject({ method: "POST", url: `/api/v1/incidents/${incidentId}/hypotheses/generate`, headers: writeHeaders, payload: {} });
  assert.equal(generated.statusCode, 200);
  const hypotheses = generated.json().hypotheses as Array<{ id: string; confidence: number }>;
  assert.equal(hypotheses.length, 1);
  assert.ok(hypotheses[0]!.confidence > 0);

  const feedback = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${incidentId}/hypotheses/${hypotheses[0]!.id}/feedback`,
    headers: writeHeaders,
    payload: { status: "confirmed_by_human", note: "Confirmed in the integration scenario" },
  });
  assert.equal(feedback.statusCode, 200);
  assert.equal(feedback.json().hypothesis.status, "confirmed_by_human");
});

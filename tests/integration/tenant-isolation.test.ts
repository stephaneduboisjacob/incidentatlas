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
const origin = process.env.INCIDENTATLAS_PUBLIC_ORIGIN ?? "http://localhost:5173";
process.env.INCIDENTATLAS_PUBLIC_ORIGIN = origin;

const { createApp } = await import("../../apps/api/src/app.js");
const { csrfToken } = await import("../../apps/api/src/security.js");
const pool = new Pool({ connectionString: databaseUrl, application_name: "incidentatlas-test", max: 4 });
const ids = {
  orgA: randomUUID(), orgB: randomUUID(),
  userA: randomUUID(), userB: randomUUID(),
  hostA: randomUUID(), hostB: randomUUID(),
  collectorA: randomUUID(), collectorB: randomUUID(),
  eventA: randomUUID(), eventB: randomUUID(),
  artifactB: randomUUID(), incidentB: randomUUID(),
};
const sessionTokenA = randomBytes(32).toString("base64url");
const sessionTokenB = randomBytes(32).toString("base64url");
const sessionIdA = randomUUID();
const sessionIdB = randomUUID();
const bytes = (value: string): Buffer => createHash("sha256").update(value).digest();
const app = await createApp(pool);

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'Tenant A'), ($3, $4, 'Tenant B')", [ids.orgA, `test-a-${ids.orgA}`, ids.orgB, `test-b-${ids.orgB}`]);
    await client.query("INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, 'test-only', 'Tenant A'), ($3, $4, 'test-only', 'Tenant B')", [ids.userA, `${ids.userA}@example.invalid`, ids.userB, `${ids.userB}@example.invalid`]);
    await client.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $4, 'owner')", [ids.orgA, ids.userA, ids.orgB, ids.userB]);
    await client.query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour'), ($4, $5, $6, now() + interval '1 hour')", [sessionIdA, ids.userA, bytes(sessionTokenA), sessionIdB, ids.userB, bytes(sessionTokenB)]);
    await client.query(
      `INSERT INTO hosts (id, organization_id, machine_id_hash, hostname, operating_system) VALUES
       ($1, $2, repeat('a', 64), 'tenant-a-host', 'test-linux'), ($3, $4, repeat('b', 64), 'tenant-b-host', 'test-linux')`,
      [ids.hostA, ids.orgA, ids.hostB, ids.orgB],
    );
    await client.query(
      `INSERT INTO collectors (id, organization_id, host_id, token_hash, agent_version, schema_version) VALUES
       ($1, $2, $3, $4, 'test', 1), ($5, $6, $7, $8, 'test', 1)`,
      [ids.collectorA, ids.orgA, ids.hostA, bytes("test-collector-a"), ids.collectorB, ids.orgB, ids.hostB, bytes("test-collector-b")],
    );
    await client.query(
      `INSERT INTO events (id, organization_id, host_id, collector_id, schema_version, occurred_at, observed_at,
        source, category, event_type, severity, change_kind, resource, summary, event_digest, redaction_ruleset, agent_version)
       VALUES ($1, $2, $3, $4, 1, now(), now(), 'systemd', 'process', 'systemd.service_state_changed', 'info', 'start',
        '{"type":"service","id":"api.service"}', 'Tenant A event', repeat('a', 64), 'test', 'test'),
        ($5, $6, $7, $8, 1, now(), now(), 'systemd', 'process', 'systemd.service_state_changed', 'info', 'start',
        '{"type":"service","id":"api.service"}', 'Tenant B event', repeat('b', 64), 'test', 'test')`,
      [ids.eventA, ids.orgA, ids.hostA, ids.collectorA, ids.eventB, ids.orgB, ids.hostB, ids.collectorB],
    );
    await client.query(
      `INSERT INTO artifacts (id, organization_id, sha256, object_key, mime_type, size_bytes, source, redaction_status)
       VALUES ($1, $2, repeat('c', 64), repeat('c', 64), 'text/plain', 8, 'test', 'redacted')`,
      [ids.artifactB, ids.orgB],
    );
    await client.query(
      `INSERT INTO incidents (id, organization_id, title, status, severity, started_at)
       VALUES ($1, $2, 'Tenant B incident', 'open', 'medium', now())`,
      [ids.incidentB, ids.orgB],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup(): Promise<void> {
  const orgs = [ids.orgA, ids.orgB];
  await pool.query("DELETE FROM audit_events WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM annotations WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM hypothesis_evidence WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM hypotheses WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM jobs WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM events WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM artifacts WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM collectors WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM hosts WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM legal_holds WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM retention_policies WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM incidents WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1::uuid[])", [[ids.userA, ids.userB]]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = ANY($1::uuid[])", [orgs]);
  await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [[ids.userA, ids.userB]]);
  await pool.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [orgs]);
}

test("tenant-owned events, hosts, artifacts, incidents, and annotations stay isolated", async (context) => {
  context.after(async () => {
    await app.close();
    await cleanup();
    await pool.end();
  });
  await seed();

  const response = await app.inject({ method: "GET", url: "/api/v1/hosts", headers: { cookie: `ia_session=${sessionTokenA}` } });
  assert.equal(response.statusCode, 200);
  const hosts = response.json().hosts as Array<{ id: string }>;
  assert.deepEqual(hosts.map((host) => host.id), [ids.hostA]);

  const events = await app.inject({ method: "GET", url: "/api/v1/events?limit=20", headers: { cookie: `ia_session=${sessionTokenA}` } });
  assert.equal(events.statusCode, 200);
  assert.deepEqual((events.json().events as Array<{ id: string }>).map((event) => event.id), [ids.eventA]);

  const event = await app.inject({ method: "GET", url: `/api/v1/events/${ids.eventB}`, headers: { cookie: `ia_session=${sessionTokenA}` } });
  assert.equal(event.statusCode, 404);
  const hostFilter = await app.inject({ method: "GET", url: `/api/v1/events?host_id=${ids.hostB}`, headers: { cookie: `ia_session=${sessionTokenA}` } });
  assert.equal(hostFilter.statusCode, 200);
  assert.deepEqual(hostFilter.json().events, []);

  const artifact = await app.inject({ method: "GET", url: `/api/v1/artifacts/${ids.artifactB}`, headers: { cookie: `ia_session=${sessionTokenA}` } });
  assert.equal(artifact.statusCode, 404);
  const timeline = await app.inject({ method: "GET", url: `/api/v1/incidents/${ids.incidentB}/timeline`, headers: { cookie: `ia_session=${sessionTokenA}` } });
  assert.equal(timeline.statusCode, 404);

  const annotation = await app.inject({
    method: "POST",
    url: `/api/v1/incidents/${ids.incidentB}/annotations`,
    headers: { cookie: `ia_session=${sessionTokenA}`, origin, "x-csrf-token": csrfToken(sessionTokenA), "content-type": "application/json" },
    payload: { body: "cross-tenant attempt", event_id: ids.eventB },
  });
  assert.equal(annotation.statusCode, 404);
});

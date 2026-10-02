import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import dotenv from "dotenv";
import { Pool } from "pg";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: resolve(root, ".env"), quiet: true });
const envFile = await readFile(resolve(root, ".env"), "utf8").catch(() => "");
const postgresPassword = envFile.match(/^POSTGRES_PASSWORD=(.+)$/m)?.[1];
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? (postgresPassword ? `postgres://incidentatlas:${postgresPassword}@127.0.0.1:55432/incidentatlas` : process.env.DATABASE_URL);
if (!databaseUrl) throw new Error("Set TEST_DATABASE_URL or provide the isolated Compose PostgreSQL service");
const testDatabase = new URL(databaseUrl);
if (testDatabase.hostname !== "127.0.0.1" || testDatabase.port !== "55432" || testDatabase.pathname !== "/incidentatlas") {
  throw new Error("Integration tests require the isolated localhost Compose database at 127.0.0.1:55432/incidentatlas");
}

const artifactRoot = await mkdtemp(resolve(tmpdir(), "incidentatlas-retention-test-"));
process.env.INCIDENTATLAS_ARTIFACT_PATH = artifactRoot;
process.env.INCIDENTATLAS_PUBLIC_ORIGIN = process.env.INCIDENTATLAS_PUBLIC_ORIGIN ?? "http://localhost:5173";
const origin = process.env.INCIDENTATLAS_PUBLIC_ORIGIN;
const [{ createApp }, { csrfToken }, { storeArtifact, readArtifact }, { runRetentionBatch }] = await Promise.all([
  import("../../apps/api/src/app.js"),
  import("../../apps/api/src/security.js"),
  import("../../apps/api/src/artifact-store.js"),
  import("../../apps/worker/src/retention.js"),
]);
const pool = new Pool({ connectionString: databaseUrl, application_name: "incidentatlas-retention-test", max: 4 });
const app = await createApp(pool);
const ids = {
  org: randomUUID(), user: randomUUID(), session: randomUUID(), host: randomUUID(), collector: randomUUID(),
  heldIncident: randomUUID(), freeIncident: randomUUID(), heldEvent: randomUUID(), freeEvent: randomUUID(),
  heldArtifact: randomUUID(), freeArtifact: randomUUID(), hypothesis: randomUUID(), annotation: randomUUID(),
  oldAudit: randomUUID(),
};
const token = randomBytes(32).toString("base64url");
const hashBytes = (value: string | Buffer): Buffer => createHash("sha256").update(value).digest();
const heldContent = Buffer.from("held test evidence");
const freeContent = Buffer.from("expired test evidence");
let heldDigest = "";
let freeDigest = "";

async function seed(): Promise<void> {
  const heldStored = await storeArtifact(heldContent);
  const freeStored = await storeArtifact(freeContent);
  heldDigest = heldStored.sha256;
  freeDigest = freeStored.sha256;
  await pool.query("INSERT INTO organizations (id, slug, name) VALUES ($1, $2, 'Retention test')", [ids.org, `retention-${ids.org}`]);
  await pool.query("INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, 'test-only', 'Retention test')", [ids.user, `${ids.user}@example.invalid`]);
  await pool.query("INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')", [ids.org, ids.user]);
  await pool.query("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')", [ids.session, ids.user, hashBytes(token)]);
  await pool.query("INSERT INTO hosts (id, organization_id, machine_id_hash, hostname, operating_system) VALUES ($1, $2, repeat('d', 64), 'retention-host', 'test-linux')", [ids.host, ids.org]);
  await pool.query("INSERT INTO collectors (id, organization_id, host_id, token_hash, agent_version, schema_version) VALUES ($1, $2, $3, $4, 'test', 1)", [ids.collector, ids.org, ids.host, hashBytes("retention-collector")]);
  await pool.query(
    `INSERT INTO incidents (id, organization_id, title, status, severity, started_at, time_window_before, time_window_after)
     VALUES ($1, $3, 'Held incident', 'open', 'high', now() - interval '3 days', interval '2 days', interval '1 day'),
            ($2, $3, 'Unheld incident', 'open', 'medium', now() - interval '10 days', interval '2 days', interval '1 day')`,
    [ids.heldIncident, ids.freeIncident, ids.org],
  );
  await pool.query("INSERT INTO legal_holds (id, organization_id, incident_id, reason, created_by) VALUES ($1, $2, $3, 'Preserve held fixture', $4)", [randomUUID(), ids.org, ids.heldIncident, ids.user]);
  const heldEvidence = [{ artifact_id: ids.heldArtifact, kind: "test" }];
  const freeEvidence = [{ artifact_id: ids.freeArtifact, kind: "test" }];
  await pool.query(
    `INSERT INTO events (id, organization_id, host_id, collector_id, schema_version, occurred_at, observed_at,
       source, category, event_type, severity, change_kind, resource, summary, evidence, event_digest, redaction_ruleset, agent_version)
     VALUES ($1, $3, $4, $5, 1, now() - interval '3 days', now() - interval '3 days', 'systemd', 'process', 'systemd.service_state_changed', 'info', 'failure',
       '{"type":"service","id":"held.service"}', 'Held event', $6::jsonb, repeat('e', 64), 'test', 'test'),
            ($2, $3, $4, $5, 1, now() - interval '10 days', now() - interval '10 days', 'systemd', 'process', 'systemd.service_state_changed', 'info', 'failure',
       '{"type":"service","id":"free.service"}', 'Expired event', $7::jsonb, repeat('f', 64), 'test', 'test')`,
    [ids.heldEvent, ids.freeEvent, ids.org, ids.host, ids.collector, JSON.stringify(heldEvidence), JSON.stringify(freeEvidence)],
  );
  await pool.query(
    `INSERT INTO artifacts (id, organization_id, sha256, object_key, mime_type, size_bytes, source, redaction_status, created_at)
     VALUES ($1, $3, $4, $5, 'text/plain', $6, 'test', 'redacted', now() - interval '3 days'),
            ($2, $3, $7, $8, 'text/plain', $9, 'test', 'redacted', now() - interval '3 days')`,
    [ids.heldArtifact, ids.freeArtifact, ids.org, heldDigest, heldDigest, heldContent.length, freeDigest, freeDigest, freeContent.length],
  );
  await pool.query("INSERT INTO annotations (id, organization_id, incident_id, event_id, user_id, body) VALUES ($1, $2, $3, $4, $5, 'Fixture annotation')", [ids.annotation, ids.org, ids.freeIncident, ids.freeEvent, ids.user]);
  await pool.query(
    `INSERT INTO hypotheses (id, organization_id, incident_id, title, description, status, generated_by, source_event_id)
     VALUES ($1, $2, $3, 'Fixture hypothesis', '', 'suggested', 'deterministic', $4)`,
    [ids.hypothesis, ids.org, ids.freeIncident, ids.freeEvent],
  );
  await pool.query("INSERT INTO hypothesis_evidence (organization_id, hypothesis_id, event_id, relationship, weight, explanation) VALUES ($1, $2, $3, 'supporting', 1, 'Fixture evidence')", [ids.org, ids.hypothesis, ids.freeEvent]);
  await pool.query("INSERT INTO retention_policies (organization_id, event_days, artifact_days, audit_days, ai_generation_days) VALUES ($1, 1, 1, 1, 1)", [ids.org]);
  await pool.query(
    "INSERT INTO audit_events (id, organization_id, action, target_type, occurred_at) VALUES ($1, $2, 'test.expired', 'test', now() - interval '10 days')",
    [ids.oldAudit, ids.org],
  );
}

async function cleanup(): Promise<void> {
  await pool.query("DELETE FROM audit_events WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM jobs WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM annotations WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM hypothesis_evidence WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM hypotheses WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM events WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM artifacts WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM legal_holds WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM retention_policies WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM incidents WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM collectors WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM hosts WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [ids.user]);
  await pool.query("DELETE FROM organization_memberships WHERE organization_id = $1", [ids.org]);
  await pool.query("DELETE FROM users WHERE id = $1", [ids.user]);
  await pool.query("DELETE FROM organizations WHERE id = $1", [ids.org]);
}

test("retention expires bounded evidence, preserves legal holds, and keeps history coherent", async (context) => {
  context.after(async () => {
    await app.close();
    await cleanup();
    await pool.end();
    await rm(artifactRoot, { recursive: true, force: true });
  });
  await seed();

  const batch = await runRetentionBatch(pool, ids.org);
  assert.deepEqual(batch, { eventsExpired: 1, artifactsExpired: 1, auditExpired: 1, hasMore: false });
  const eventRows = await pool.query<{ id: string }>("SELECT id FROM events WHERE organization_id = $1 ORDER BY id", [ids.org]);
  assert.deepEqual(eventRows.rows.map((row) => row.id), [ids.heldEvent]);
  const heldContentAfter = await readArtifact(heldDigest, heldDigest);
  assert.deepEqual(heldContentAfter, heldContent);
  await assert.rejects(stat(resolve(artifactRoot, freeDigest.slice(0, 2), freeDigest)), { code: "ENOENT" });
  assert.equal((await pool.query("SELECT purged_at, purge_reason FROM artifacts WHERE organization_id = $1 AND id = $2", [ids.org, ids.freeArtifact])).rows[0]?.purge_reason, "retention_policy");
  const expiredDownload = await app.inject({ method: "GET", url: `/api/v1/artifacts/${ids.freeArtifact}`, headers: { cookie: `ia_session=${token}` } });
  assert.equal(expiredDownload.statusCode, 410);
  const annotation = await pool.query("SELECT event_id FROM annotations WHERE id = $1", [ids.annotation]);
  assert.equal(annotation.rows[0]?.event_id, null);
  const hypothesis = await pool.query("SELECT source_event_id FROM hypotheses WHERE id = $1", [ids.hypothesis]);
  assert.equal(hypothesis.rows[0]?.source_event_id, null);
  assert.equal((await pool.query("SELECT 1 FROM hypothesis_evidence WHERE organization_id = $1", [ids.org])).rowCount, 0);
  const audits = await pool.query<{ action: string; attributes: Record<string, unknown> }>("SELECT action, attributes FROM audit_events WHERE organization_id = $1", [ids.org]);
  assert.deepEqual(audits.rows.map((row) => row.action).sort(), ["retention.artifacts_expired", "retention.audit_expired", "retention.events_expired"]);
  assert.ok(audits.rows.some((row) => (row.attributes.ids as string[]).includes(ids.freeEvent)));
  assert.ok(audits.rows.some((row) => (row.attributes.ids as string[]).includes(ids.oldAudit)));

  const cookie = `ia_session=${token}`;
  const headers = { cookie, origin, "x-csrf-token": csrfToken(token), "content-type": "application/json" };
  const initialPolicy = await app.inject({ method: "GET", url: "/api/v1/settings/retention", headers: { cookie } });
  assert.equal(initialPolicy.statusCode, 200);
  const updated = await app.inject({
    method: "PUT", url: "/api/v1/settings/retention", headers,
    payload: { event_days: 14, artifact_days: 21, audit_days: 90, ai_generation_days: 30 },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().policy.event_days, 14);
  const shorterWithoutConfirmation = await app.inject({
    method: "PUT", url: "/api/v1/settings/retention", headers,
    payload: { event_days: 1, artifact_days: 21, audit_days: 90, ai_generation_days: 30 },
  });
  assert.equal(shorterWithoutConfirmation.statusCode, 409);
  assert.equal(shorterWithoutConfirmation.json().error.code, "retention_reduction_confirmation_required");
  const confirmedShorterPolicy = await app.inject({
    method: "PUT", url: "/api/v1/settings/retention", headers,
    payload: { event_days: 1, artifact_days: 21, audit_days: 90, ai_generation_days: 30, confirm_immediate_expiry: true },
  });
  assert.equal(confirmedShorterPolicy.statusCode, 200);
  const created = await app.inject({
    method: "POST", url: "/api/v1/legal-holds", headers,
    payload: { incident_id: ids.heldIncident, reason: "Retain the investigation record" },
  });
  assert.equal(created.statusCode, 201);
  const holdId = created.json().legal_hold.id as string;
  const released = await app.inject({ method: "POST", url: `/api/v1/legal-holds/${holdId}/release`, headers, payload: { reason: "Review complete" } });
  assert.equal(released.statusCode, 200);
  const holds = await app.inject({ method: "GET", url: "/api/v1/legal-holds", headers: { cookie } });
  assert.equal(holds.statusCode, 200);
  assert.ok((holds.json().legal_holds as Array<{ id: string }>).some((hold) => hold.id === holdId));
  const missingCsrf = await app.inject({ method: "POST", url: "/api/v1/legal-holds", headers: { cookie, origin, "content-type": "application/json" }, payload: { reason: "No token" } });
  assert.equal(missingCsrf.statusCode, 403);
});

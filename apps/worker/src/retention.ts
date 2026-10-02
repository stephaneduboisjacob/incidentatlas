import { randomUUID, createHash } from "node:crypto";
import { lstat, readFile, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import type { Pool } from "pg";

const BATCH_LIMIT = 100;
const ARTIFACT_ROOT = process.env.INCIDENTATLAS_ARTIFACT_PATH ?? "/var/lib/incidentatlas/artifacts";
const DIGEST_RE = /^[a-f0-9]{64}$/;

interface RetentionBatchResult {
  eventsExpired: number;
  artifactsExpired: number;
  auditExpired: number;
  hasMore: boolean;
}

async function removeArtifact(objectKey: string, expectedSha256: string): Promise<void> {
  if (objectKey !== expectedSha256 || !DIGEST_RE.test(objectKey) || !isAbsolute(ARTIFACT_ROOT)) throw new Error("invalid_artifact_object");
  try {
    const rootStat = await lstat(ARTIFACT_ROOT);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("invalid_artifact_root");
    const root = await realpath(ARTIFACT_ROOT);
    const target = resolve(root, objectKey.slice(0, 2), objectKey);
    const parent = dirname(target);
    const parentStat = await lstat(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !(await realpath(parent)).startsWith(`${root}${sep}`)) {
      throw new Error("invalid_artifact_path");
    }
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !(await realpath(target)).startsWith(`${root}${sep}`)) {
      throw new Error("invalid_artifact_path");
    }
    const digest = createHash("sha256").update(await readFile(target)).digest("hex");
    if (digest !== expectedSha256) throw new Error("artifact_integrity_failure");
    await unlink(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

function auditAttributes(ids: string[], digests?: string[]): string {
  return JSON.stringify({ count: ids.length, ids, ...(digests ? { sha256: digests } : {}) });
}

export async function runRetentionBatch(pool: Pool, organizationId: string, limit = BATCH_LIMIT): Promise<RetentionBatchResult> {
  if (!Number.isInteger(limit) || limit < 1 || limit > BATCH_LIMIT) throw new Error("invalid_retention_batch_limit");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 912843))", [`retention:${organizationId}`]);
    const policyResult = await client.query<{ event_days: number; artifact_days: number; audit_days: number }>(
      "SELECT event_days, artifact_days, audit_days FROM retention_policies WHERE organization_id = $1",
      [organizationId],
    );
    const policy = policyResult.rows[0];
    if (!policy) {
      await client.query("COMMIT");
      return { eventsExpired: 0, artifactsExpired: 0, auditExpired: 0, hasMore: false };
    }

    const oldEvents = await client.query<{ id: string; event_digest: string }>(
      `SELECT e.id, e.event_digest FROM events e
        WHERE e.organization_id = $1 AND e.occurred_at < now() - ($2 * interval '1 day')
          AND NOT EXISTS (
            SELECT 1 FROM legal_holds h WHERE h.organization_id = e.organization_id
              AND h.released_at IS NULL AND h.incident_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM legal_holds h JOIN incidents i
              ON i.organization_id = h.organization_id AND i.id = h.incident_id
             WHERE h.organization_id = e.organization_id AND h.released_at IS NULL
               AND e.occurred_at BETWEEN i.started_at - i.time_window_before AND i.started_at + i.time_window_after
          )
        ORDER BY e.occurred_at, e.id LIMIT $3 FOR UPDATE OF e SKIP LOCKED`,
      [organizationId, policy.event_days, limit],
    );
    const eventIds = oldEvents.rows.map((row) => row.id);
    if (eventIds.length) {
      await client.query("UPDATE annotations SET event_id = NULL WHERE organization_id = $1 AND event_id = ANY($2::uuid[])", [organizationId, eventIds]);
      await client.query("DELETE FROM hypothesis_evidence WHERE organization_id = $1 AND event_id = ANY($2::uuid[])", [organizationId, eventIds]);
      await client.query("UPDATE hypotheses SET source_event_id = NULL WHERE organization_id = $1 AND source_event_id = ANY($2::uuid[])", [organizationId, eventIds]);
      await client.query("DELETE FROM events WHERE organization_id = $1 AND id = ANY($2::uuid[])", [organizationId, eventIds]);
      await client.query(
        `INSERT INTO audit_events (id, organization_id, action, target_type, attributes)
         VALUES ($1, $2, 'retention.events_expired', 'event', $3::jsonb)`,
        [randomUUID(), organizationId, auditAttributes(eventIds, oldEvents.rows.map((row) => row.event_digest))],
      );
    }

    const oldArtifacts = await client.query<{ id: string; sha256: string; object_key: string }>(
      `SELECT a.id, a.sha256, a.object_key FROM artifacts a
        WHERE a.organization_id = $1 AND a.purged_at IS NULL
          AND a.created_at < now() - ($2 * interval '1 day')
          AND NOT EXISTS (
            SELECT 1 FROM legal_holds h WHERE h.organization_id = a.organization_id
              AND h.released_at IS NULL AND h.incident_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM events e JOIN LATERAL jsonb_array_elements(e.evidence) ev ON true
              JOIN legal_holds h ON h.organization_id = e.organization_id AND h.incident_id IS NOT NULL AND h.released_at IS NULL
              JOIN incidents i ON i.organization_id = h.organization_id AND i.id = h.incident_id
             WHERE e.organization_id = a.organization_id AND ev.value->>'artifact_id' = a.id::text
               AND e.occurred_at BETWEEN i.started_at - i.time_window_before AND i.started_at + i.time_window_after
          )
        ORDER BY a.created_at, a.id LIMIT $3`,
      [organizationId, policy.artifact_days, limit],
    );
    const artifactIds: string[] = [];
    const artifactDigests: string[] = [];
    for (const candidate of oldArtifacts.rows) {
      // Lock order matches uploads and downloads: content digest, then metadata row.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 912843))", [`artifact:${candidate.sha256}`]);
      const artifact = await client.query<{ id: string; sha256: string; object_key: string }>(
        `SELECT id, sha256, object_key FROM artifacts
          WHERE organization_id = $1 AND id = $2 AND purged_at IS NULL
            AND sha256 = $3 AND created_at < now() - ($4 * interval '1 day') FOR UPDATE`,
        [organizationId, candidate.id, candidate.sha256, policy.artifact_days],
      );
      const lockedArtifact = artifact.rows[0];
      if (!lockedArtifact) continue;
      const stillReferenced = await client.query(
        "SELECT 1 FROM artifacts WHERE sha256 = $1 AND purged_at IS NULL AND NOT (organization_id = $2 AND id = $3) LIMIT 1",
        [lockedArtifact.sha256, organizationId, lockedArtifact.id],
      );
      if (!stillReferenced.rowCount) await removeArtifact(lockedArtifact.object_key, lockedArtifact.sha256);
      await client.query(
        "UPDATE artifacts SET purged_at = now(), purge_reason = 'retention_policy' WHERE organization_id = $1 AND id = $2",
        [organizationId, lockedArtifact.id],
      );
      artifactIds.push(lockedArtifact.id);
      artifactDigests.push(lockedArtifact.sha256);
    }
    if (artifactIds.length) {
      await client.query(
        `INSERT INTO audit_events (id, organization_id, action, target_type, attributes)
         VALUES ($1, $2, 'retention.artifacts_expired', 'artifact', $3::jsonb)`,
        [randomUUID(), organizationId, auditAttributes(artifactIds, artifactDigests)],
      );
    }

    const oldAudit = await client.query<{ id: string }>(
      `SELECT id FROM audit_events WHERE organization_id = $1
        AND occurred_at < now() - ($2 * interval '1 day')
        ORDER BY occurred_at, id LIMIT $3 FOR UPDATE SKIP LOCKED`,
      [organizationId, policy.audit_days, limit],
    );
    const auditIds = oldAudit.rows.map((row) => row.id);
    if (auditIds.length) {
      await client.query("DELETE FROM audit_events WHERE organization_id = $1 AND id = ANY($2::uuid[])", [organizationId, auditIds]);
      await client.query(
        `INSERT INTO audit_events (id, organization_id, action, target_type, attributes)
         VALUES ($1, $2, 'retention.audit_expired', 'audit_event', $3::jsonb)`,
        [randomUUID(), organizationId, auditAttributes(auditIds)],
      );
    }
    const hasMore = eventIds.length === limit || oldArtifacts.rows.length === limit || auditIds.length === limit;
    await client.query("COMMIT");
    return { eventsExpired: eventIds.length, artifactsExpired: artifactIds.length, auditExpired: auditIds.length, hasMore };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function scheduleRetentionSweeps(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO jobs (organization_id, job_type, payload)
     SELECT p.organization_id, 'retention.sweep', '{}'::jsonb FROM retention_policies p
      WHERE NOT EXISTS (
        SELECT 1 FROM jobs j WHERE j.organization_id = p.organization_id AND j.job_type = 'retention.sweep'
          AND j.state IN ('queued', 'running')
      )
        AND NOT EXISTS (
          SELECT 1 FROM jobs j WHERE j.organization_id = p.organization_id AND j.job_type = 'retention.sweep'
            AND j.created_at >= now() - interval '24 hours'
        )
     ON CONFLICT (organization_id) WHERE job_type = 'retention.sweep' AND state IN ('queued', 'running') DO NOTHING`,
  );
}

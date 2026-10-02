import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { EventSchema, type IncidentEvent } from "@incidentatlas/event-schema";
import { rankEvents } from "@incidentatlas/correlation";
import { Pool, type PoolClient } from "pg";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../../");
dotenv.config({ path: resolve(projectRoot, ".env"), quiet: true });
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Required configuration DATABASE_URL is missing");

const pool = new Pool({ connectionString: databaseUrl, application_name: "incidentatlas-worker", max: 4, connectionTimeoutMillis: 5_000 });
const stop = new AbortController();
let stopping = false;
process.once("SIGINT", () => { stopping = true; stop.abort(); });
process.once("SIGTERM", () => { stopping = true; stop.abort(); });

interface Job {
  id: string;
  organization_id: string;
  job_type: string;
  payload: { incident_id?: string };
  attempts: number;
}

async function claimJob(): Promise<Job | undefined> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE jobs SET state = 'queued', locked_at = NULL WHERE state = 'running' AND locked_at < now() - interval '10 minutes'");
    const result = await client.query<Job>(
      `SELECT id, organization_id, job_type, payload, attempts FROM jobs
        WHERE state = 'queued' AND available_at <= now()
        ORDER BY available_at, id FOR UPDATE SKIP LOCKED LIMIT 1`,
    );
    const job = result.rows[0];
    if (!job) {
      await client.query("COMMIT");
      return undefined;
    }
    await client.query("UPDATE jobs SET state = 'running', attempts = attempts + 1, locked_at = now() WHERE id = $1", [job.id]);
    await client.query("COMMIT");
    return { ...job, attempts: job.attempts + 1 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function parseEvent(row: Record<string, unknown>): IncidentEvent | undefined {
  const event = EventSchema.safeParse({
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
  return event.success ? event.data : undefined;
}

async function rebuildCorrelation(client: PoolClient, job: Job): Promise<void> {
  const incidentId = job.payload.incident_id;
  if (!incidentId) throw new Error("invalid_correlation_job");
  const incidentResult = await client.query<{
    id: string; started_at: Date; time_window_before: string; time_window_after: string; affected_services: string[];
  }>(
    `SELECT id, started_at, extract(epoch from time_window_before) / 60 AS time_window_before,
            extract(epoch from time_window_after) / 60 AS time_window_after, affected_services
       FROM incidents WHERE organization_id = $1 AND id = $2`,
    [job.organization_id, incidentId],
  );
  const incident = incidentResult.rows[0];
  if (!incident) return;
  const eventResult = await client.query(
    `SELECT id, occurred_at, observed_at, source, category, event_type, severity, change_kind,
            actor, resource, summary, before_state, after_state, attributes, evidence,
            correlation, redaction_ruleset
       FROM events WHERE organization_id = $1
        AND occurred_at BETWEEN ($2::timestamptz - $3::interval) AND ($2::timestamptz + $4::interval)
       ORDER BY occurred_at ASC, id ASC LIMIT 2000`,
    [job.organization_id, incident.started_at, `${incident.time_window_before} minutes`, `${incident.time_window_after} minutes`],
  );
  const events = eventResult.rows.map((row) => parseEvent(row as Record<string, unknown>)).filter((event): event is IncidentEvent => Boolean(event));
  const ranked = rankEvents(events, {
    id: incident.id,
    startedAt: incident.started_at.toISOString(),
    windowBeforeMinutes: Number(incident.time_window_before),
    windowAfterMinutes: Number(incident.time_window_after),
    affectedServices: incident.affected_services,
  }).filter((score) => score.relationship === "supporting" && score.score >= 45).slice(0, 10);
  const eventsById = new Map(events.map((event) => [event.event_id, event]));
  for (const candidate of ranked) {
    const event = eventsById.get(candidate.eventId);
    if (!event) continue;
    const hypothesisId = randomUUID();
    const explanation = candidate.factors.filter((factor) => factor.points > 0).map((factor) => factor.explanation).join(" ");
    const inserted = await client.query(
      `INSERT INTO hypotheses (id, organization_id, incident_id, title, description, status, generated_by, confidence, source_event_id)
       VALUES ($1, $2, $3, $4, $5, 'suggested', 'deterministic', $6, $7)
       ON CONFLICT DO NOTHING RETURNING id`,
      [hypothesisId, job.organization_id, incident.id, `${event.summary} may be related`, explanation, Math.min(1, candidate.score / 100), event.event_id],
    );
    if (!inserted.rows[0]) continue;
    await client.query(
      `INSERT INTO hypothesis_evidence (organization_id, hypothesis_id, event_id, relationship, weight, explanation)
       VALUES ($1, $2, $3, 'supporting', $4, $5)`,
      [job.organization_id, hypothesisId, event.event_id, candidate.score, explanation],
    );
  }
}

async function processJob(job: Job): Promise<void> {
  try {
    if (job.job_type === "correlation.rebuild") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await rebuildCorrelation(client, job);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else {
      throw new Error("unsupported_job_type");
    }
    await pool.query("UPDATE jobs SET state = 'complete', locked_at = NULL, last_error_code = NULL, finished_at = now() WHERE id = $1", [job.id]);
  } catch (error) {
    const retry = job.attempts < 5;
    const delaySeconds = Math.min(300, 2 ** job.attempts * 5);
    const errorCode = error instanceof Error && ["invalid_correlation_job", "unsupported_job_type"].includes(error.message)
      ? error.message
      : "processing_failed";
    await pool.query(
      `UPDATE jobs SET state = $2, locked_at = NULL, last_error_code = $4,
                       available_at = now() + ($3 * interval '1 second'), finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
        WHERE id = $1`,
      [job.id, retry ? "queued" : "failed", delaySeconds, errorCode],
    );
    console.error(JSON.stringify({ event: "worker.job.failed", job_id: job.id, job_type: job.job_type, retry, error_code: errorCode }));
  }
}

console.info(JSON.stringify({ event: "worker.started" }));
while (!stopping) {
  try {
    const job = await claimJob();
    if (job) await processJob(job);
    else await sleep(1_000, undefined, { signal: stop.signal }).catch(() => undefined);
  } catch {
    console.error(JSON.stringify({ event: "worker.poll.failed" }));
    await sleep(3_000, undefined, { signal: stop.signal }).catch(() => undefined);
  }
}
await pool.end();
console.info(JSON.stringify({ event: "worker.stopped" }));

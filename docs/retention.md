# Retention and evidence lifecycle

Retention is configured per organization at `/api/v1/settings/retention` and in
the web interface under **Retention & holds**. Event, artifact, audit, and
future AI-generation windows are independent, in days, from 1 through 3650.
Defaults are 90, 30, 365, and 30 days respectively. AI generation storage is
not implemented yet; its setting is reserved and does not currently remove
records.

Changing a window to a shorter duration requires an explicit confirmation
field in the API or a browser confirmation in the interface. The update queues
asynchronous cleanup. A worker schedules a sweep at least daily, and policy
changes request an immediate sweep. Each run handles at most 100 events,
artifacts, and audit records per batch, then requeues itself when more work is
due. Cleanup is not a synchronous request operation.

## Legal holds

Organization owners and admins can enable a global hold or a hold for one
incident. Global holds protect all organization events and artifacts from
retention. Incident holds protect events that fall within the incident's
configured before/after time window, along with artifacts referenced by those
events. Holds have a required reason. Release requires a separate reason and
records who released the hold, when, and why. Hold creation and release are
audited. Retention and hold changes serialize on an organization-scoped
database lock so cleanup cannot race a newly enabled hold.

## What cleanup does

- Expired events are removed in bounded batches. Event-linked annotations are
  retained with their event reference cleared; hypothesis evidence links and
  source-event references are cleared while hypothesis feedback remains.
- Expired artifact payloads are removed from the digest-addressed filesystem.
  Metadata stays in PostgreSQL with a purge timestamp and reason, so old event
  evidence references remain traceable and downloads return `410 Gone`.
  Shared content is only unlinked when no active artifact record references
  the same digest. Uploading identical evidence later restores its metadata and
  payload.
- Expired audit rows are deleted in bounded batches. A new aggregate audit row
  records the deleted IDs/count; event and artifact cleanup audit records also
  include identifiers and digests, not the expired payloads.
- Incidents, hypotheses, legal holds, and user accounts are not automatically
  deleted by retention.

The worker validates artifact identifiers, confines resolved paths to the
configured artifact root, checks for symlinks, and verifies SHA-256 before
unlinking. If cleanup fails, the job is retried and an internal safe error code
is logged. Postgres metadata and filesystem deletion cannot share one atomic
transaction: if a process stops after unlink but before commit, the retry sees
the missing object and completes the metadata purge.

## Backups

PostgreSQL metadata and the artifact volume are separate persistent stores.
`deploy/scripts/backup.sh` quiesces the API and worker, captures both stores,
and writes checksums and row counts. `deploy/scripts/verify-backup.sh` verifies
the content-addressed artifact archive and restores PostgreSQL into a temporary
database to compare table counts. Backups still need to be scheduled and copied
off-host by the operator. Encrypt backup storage for the sensitivity of
operational and account data. The development host collector remains in local
mode until an off-host backup copy and recovery procedure are established.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

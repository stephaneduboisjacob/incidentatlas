# Architecture

## Data path

```text
Linux sources
    ↓
Rust collector ── local redaction ── bounded SQLite queue
    ↓ authenticated, batched, idempotent delivery
Versioned ingestion API
    ↓ validation, tenant/collector authorization
PostgreSQL append-only event records ── filesystem artifact store
    ↓
Background worker ── deterministic correlation
    ↓
Incident timeline → evidence-linked hypotheses → human feedback
```

The web interface is a TypeScript React application. The versioned API and
background worker are separate modules/processes, sharing event contracts and
database access code. PostgreSQL is the only required server-side stateful
service. A local filesystem artifact backend is hidden behind an interface so
it can later be replaced without changing event semantics.

## Boundaries

- **Collector:** source observation, local normalization and redaction, durable
  delivery queue, bounded retries. It supports dry-run and local-only modes.
- **API:** authentication, schema and size validation, tenant authorization,
  event ingestion, incident operations, and read APIs.
- **Storage:** explicit SQL migrations, tenant-owned PostgreSQL rows, immutable
  event bodies, and digest-addressed artifacts.
- **Worker:** explainable correlation, retention, and later optional AI jobs.
- **Web:** timeline investigation, evidence inspection, annotations, and
  human-controlled hypothesis status.

## Deployment

The Compose deployment runs an IncidentAtlas app/API, a worker, and a dedicated
PostgreSQL service with persistent volumes and health checks. The API binds to
loopback on the host. The existing host Nginx terminates TLS and proxies the
IncidentAtlas hostname to that loopback port. It must use a separate virtual
host and must not overwrite other sites.

## Integrity and provenance

Events are append-only and idempotent by event ID. The server records an event
digest, source event ID, collector identity, and ingestion time. Artifact
metadata stores a SHA-256 digest separately from the payload. Integrity
checkpoints may be added when batch retention is implemented; no blockchain or
external notarization is planned.

## Correlation

The initial engine is deterministic and decomposable. It considers time,
resource/service relationships, change type, and symptom alignment, then
persists the reason for every evidence link. No AI output can exist without
event evidence references, and AI is not required for core use.

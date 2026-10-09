# Event model

Events represent operational state transitions, not arbitrary logs. Schema
version 1 uses validated identifiers, UTC timestamps, and JSON objects for
bounded before/after state and attributes.

## Canonical fields

```json
{
  "schema_version": 1,
  "event_id": "uuid",
  "occurred_at": "RFC 3339 UTC timestamp",
  "observed_at": "RFC 3339 UTC timestamp",
  "source": "systemd",
  "category": "process",
  "type": "systemd.service_state_changed",
  "severity": "info",
  "change_kind": "failure",
  "resource": { "type": "service", "id": "nginx.service", "name": "nginx" },
  "summary": "nginx.service transitioned from active to failed",
  "before": { "state": "active" },
  "after": { "state": "failed" },
  "attributes": {},
  "privacy": { "redaction_applied": true, "redaction_ruleset": "default" }
}
```

`organization_id`, `host_id`, collector identity, server `ingested_at`,
`agent_version`, ingestion ID, digest, and evidence links are assigned or
validated by the server rather than trusted from a collector body.

## Taxonomy

Categories: `deployment`, `configuration`, `process`, `container`, `database`,
`network`, `authentication`, `certificate`, `resource`, `external`,
`customer`, `security`, `collector`, `manual`.

Change kinds: `create`, `update`, `delete`, `start`, `stop`, `restart`,
`failure`, `recovery`, `threshold_crossed`, `anomaly`, `manual_annotation`.

Sources are validated identifiers. Initial sources are `systemd`, `docker`,
`nginx`, `postgres`, `manual`, and `collector`.

## Invariants

- A stable event UUID makes delivery idempotent.
- `occurred_at` is source time; `observed_at` is collector observation time;
  the server sets `ingested_at`. Timestamps are not silently rewritten.
- Persisted event bodies are immutable. Corrections use annotations or
  superseding events.
- An event digest covers canonical validated content. Evidence points from a
  hypothesis to event IDs and includes a relationship, score, and explanation.
- Every tenant-owned event is scoped to exactly one organization and host.
- The collector sets `redaction_applied` only after its local redaction path
  succeeds. Secrets and prohibited data are never accepted as evidence.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

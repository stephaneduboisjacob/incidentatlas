# Privacy and data minimization

IncidentAtlas records operational changes needed for incident reconstruction,
not complete host logs. The collector must redact before connected delivery.
The default collection policy excludes application payloads, Docker
environment variables, SQL text/parameters, private keys, and repository
source code.

## Data classification

| Class | Examples | Handling |
| --- | --- | --- |
| `PUBLIC` | Published release version | May be shared |
| `OPERATIONAL` | Service state, image digest, certificate expiry | Store with tenant access control |
| `SENSITIVE` | Internal hostnames, sanitized config paths, user identifiers | Minimize, restrict access, apply retention |
| `SECRET` | Passwords, API tokens, private keys, session cookies | Redact locally; never intentionally persist |
| `PROHIBITED` | Customer payloads, full table rows, arbitrary private key contents | Never collect |

Collector modes are `dry-run` (show proposed normalized/redacted records and
transmit nothing), `local` (persist only in its local queue), and `connected`
(send authenticated batches). Mode changes should be explicit and auditable.

Redaction presets cover credentials and common secret formats. Operators may
add custom patterns. Redaction failures stop transmission and surface a
collector health event; the system does not silently send the unredacted
record. Test fixtures use only intentionally fake secrets.

Product analytics are opt-in and off by default. Retention for events,
artifacts, audit data, and AI output is independently configurable. Legal hold
prevents covered evidence from normal retention deletion.

The Nginx watch source sends only the configured path and SHA-256 before/after
values. It does not upload file contents or recursively traverse directories.

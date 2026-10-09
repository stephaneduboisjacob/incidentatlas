# Linux collector

The collector is a Rust binary with no Node.js dependency. Its current sources
are systemd unit lifecycle records, explicit Nginx configuration file hashes,
and opt-in Docker container lifecycle events. It normalizes only structured
fields; journal `MESSAGE` content, Nginx configuration bytes, container
environment, labels, logs, and application payloads are not stored or sent.

The systemd source can be scoped with `sources.systemd_units`. When this list
is nonempty, only the named units are recorded; an empty list allows all unit
lifecycle changes. On shared hosts, set an explicit allowlist before leaving
dry-run mode.

## Modes

- `dry-run`: collect, normalize, locally redact, print only the proposed safe
  event plus redaction rule names. Do not queue or transmit.
- `local`: apply redaction, write to the durable local SQLite queue, and never
  contact the server.
- `connected`: queue events, enroll with a one-time token if needed, then send
  bounded batches over HTTPS. Delete queue records only after a complete API
  acknowledgment.

The default config is `/etc/incidentatlas/agent.toml`; override it with
`--config`. The queue defaults to
`/var/lib/incidentatlas/queue.sqlite3`, is bounded by `queue_max_mb`, uses
SQLite WAL plus full synchronization, and stores files with owner-only
permissions. FIFO event IDs make retries idempotent. Retry uses exponential
backoff and jitter. Queue overflow increments a durable counter and produces a
`collector.events_dropped` event when space becomes available. Delivery failure
and recovery are also represented as events.

Example scope for a shared Nginx/Docker host:

```toml
[sources]
systemd = true
systemd_units = ["docker.service", "nginx.service"]
docker = false
```

To detect Nginx configuration changes, enable `sources.nginx` and list exact
files under `[watch].files`. The collector polls those regular files every five
seconds, rejects symlinks, and hashes at most 8 MiB per file. It emits the
configured path plus before/after SHA-256 values; it does not send snapshots or
diffs and does not recursively traverse directories. Add only files whose
change metadata is appropriate for the IncidentAtlas server. Nginx syntax
validation and reload detection are not part of this source yet; systemd may
still record `nginx.service` lifecycle changes.

```toml
[sources]
nginx = true

[watch]
files = ["/etc/nginx/nginx.conf", "/etc/nginx/sites-available/incidentatlas"]
```

## Enrollment and credentials

Place the server enrollment token in the configured token file with root owner
and mode `0640`, readable only by the dedicated collector group. The collector
sends a SHA-256 hash of `/etc/machine-id`, not its raw value. The API returns a
collector-specific credential once. It is stored at the configured credential
path with mode `0600`; only its hash is stored by the server. Never copy the
token or credential into config, shell arguments, logs, or source control.

The connected mode requires an HTTPS URL with a valid certificate. It does not
disable certificate checks. The `doctor` command reports config readability,
queue health, journal access, Docker availability, time synchronization,
credential/token file presence, and HTTPS API readiness without revealing
secret values.

## Privileges

Run as the dedicated `incidentatlas` service user. The included systemd unit
grants read access to the systemd journal through the `systemd-journal` group,
restricts the filesystem to read-only except `/var/lib/incidentatlas`, removes
capabilities, enables `NoNewPrivileges`, and applies systemd hardening.

Docker collection is disabled by default. Access to `/var/run/docker.sock` or
membership in the `docker` group is effectively root-level access. An operator
who explicitly enables this source must accept that privilege and adjust the
service's supplementary group. IncidentAtlas will not silently add it.

## Commands

```text
incidentatlas-agent status
incidentatlas-agent doctor
incidentatlas-agent test-redaction
incidentatlas-agent test-source systemd
incidentatlas-agent test-source docker
incidentatlas-agent print-config
```

PostgreSQL operational queries are not implemented yet. Configuring that flag
reports it as not implemented; the collector does not pretend to collect it.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

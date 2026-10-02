# IncidentAtlas

IncidentAtlas is a self-hostable operational change recorder for reconstructing
what changed before an outage or security incident. It preserves compact,
redacted change events and their evidence, then presents an explainable
incident timeline for human investigation.

IncidentAtlas is not a bulk log platform, APM system, SIEM, or generic metrics
dashboard. The initial focus is Linux, systemd, Docker, Nginx, PostgreSQL, and
GitHub environments. The MVP starts with Linux host events and a small,
reviewable collector-to-timeline flow.

## Project status

Early development. Interfaces and schemas may change before the first stable
release. Do not use this development build as the sole record of a production
incident.

## Architecture

```text
Rust collector → bounded SQLite queue → authenticated API → PostgreSQL
                                             ↓                  ↓
                                      artifact store       worker/correlation
                                             ↓                  ↓
                                            React incident timeline
```

See [docs/architecture.md](docs/architecture.md), [docs/event-model.md](docs/event-model.md),
and [docs/decisions.md](docs/decisions.md) for details.

## Development quick start

Requirements: Node.js 24, npm, Rust/Cargo, Docker Compose, and PostgreSQL
client tools. The local Compose stack is designed to be isolated from any
existing host database or application services.

```bash
cp .env.example .env
# Replace all four "replace_with_random_hex" values using separate outputs
# from: openssl rand -hex 32
npm install
npm run build
docker compose up -d --build
```

Open the configured public origin and create the first administrator using
`INCIDENTATLAS_SETUP_TOKEN` from the private `.env` file. The setup endpoint
locks after the first account is created. The Compose database is isolated
from any PostgreSQL service already running on the host.

The deployment process and host Nginx integration are documented in
[docs/deployment.md](docs/deployment.md). See
[docs/collector.md](docs/collector.md) for current source support and
privileges. Operator-run backup and temporary restore verification scripts
are in `deploy/scripts/`.

The production Compose file keeps PostgreSQL on the private Compose network.
For integration tests, start the stack with the localhost-only test override:
`docker compose -f docker-compose.yml -f docker-compose.test.yml up -d`, then
run `npm run test:integration`.

## Privacy principles

- Collect state transitions and operational metadata, not arbitrary logs or
  application payloads.
- Redact on the monitored host before network transmission.
- Keep collector modes explicit: `dry-run`, `local`, and `connected`.
- Never collect Docker environment variables or PostgreSQL query text by
  default.
- Every hypothesis must link to supporting or contradicting evidence. Only a
  human may mark a cause as confirmed.
- Postmortems are offline Markdown drafts with event IDs, evidence digests,
  and human feedback attached.
- Retention is configurable by evidence class; legal holds protect incident
  evidence from asynchronous cleanup.
- Outbound product analytics default to off.

See [docs/privacy.md](docs/privacy.md) and [SECURITY.md](SECURITY.md).

## License

License selection is pending. Until a license is added, all rights are
reserved. Do not assume this repository is licensed for redistribution.

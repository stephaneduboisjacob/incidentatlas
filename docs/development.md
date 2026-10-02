# Development

## Host requirements

Node.js 24 and npm, Rust/Cargo, Docker Compose, and PostgreSQL client tools.
No global package installation is required. Use npm workspaces and commit the
lockfile.

## Initial milestones

1. Write architecture, event, privacy, threat, and deployment decisions.
2. Scaffold npm workspaces and local Compose with isolated PostgreSQL.
3. Add explicit tenant/event migrations and a versioned event contract.
4. Add collector enrollment, token hashing, and authenticated idempotent batch
   ingestion.
5. Add Rust config/CLI and a bounded crash-safe SQLite queue.
6. Add systemd then opt-in Docker lifecycle sources with local redaction.
7. Add an authorized timeline API and evidence detail UI.
8. Add incidents, deterministic evidence scoring, feedback, and annotations.
9. Add Nginx/PostgreSQL operational connectors and artifact handling.
10. Add retention/legal hold, hardening, deployment docs, and optional AI.

## Safety while dogfooding

Begin in dry-run mode. Review proposed fields and redactions before enabling
local buffering. Enable connected delivery only after server authentication,
retention, access controls, and collector revocation are implemented.

## Schema and operational changes

Migrations are numbered SQL files and are applied deliberately. The local
Compose database uses its own volume and does not reuse host PostgreSQL. The
production app port is loopback-only; host Nginx configuration is managed as
an additional virtual host after the service is ready.

# Administrator manual

This guide covers the current Compose deployment and the Rust host collector. Adapt commands to your environment and review `docs/deployment.md`, `docs/collector.md`, and `docs/retention.md` before production use. This is an early-development product; do not rely on it as the sole incident record.

## Deploy the server

Requirements are Node.js 24/npm for building, Docker Engine with Compose, and a host reverse proxy if exposing the service. The supplied production Compose stack runs the application/API, worker, and a private PostgreSQL 18 service. PostgreSQL is not published on a host port; the API listens on loopback port 3080 for host Nginx.

1. Clone the repository and review the checked-in deployment configuration.
2. Copy `.env.example` to `.env`. Generate a unique random value for each required secret, for example with `openssl rand -hex 32`. Keep `.env` owner-readable only and out of source control.
3. Set `INCIDENTATLAS_PUBLIC_ORIGIN` to the exact HTTPS origin users will visit.
4. Run `docker compose up -d --build`, then check `docker compose ps` and the live/ready health endpoints through the deployment.
5. Configure a new Nginx virtual host using `deploy/nginx/incidentatlas.http.conf` for ACME HTTP-01 bootstrap. Validate with `nginx -t`, obtain the certificate, install `deploy/nginx/incidentatlas.conf`, validate again, and reload. Do not replace another site's configuration. Keep the host's Certbot renewal timer and install the supplied deploy hook.
6. Create the first owner using the one-time `INCIDENTATLAS_SETUP_TOKEN` from `.env`. Retrieve it locally on the server; never send it through chat or include it in logs. Setup is permanently disabled after the first account is created.

The repository's deployment guide has the exact domain-specific example, certificate paths, and backup commands. Replace example domains with your own. TLS must be valid for collector connected mode.

## Secure the installation

Use a unique value for every secret and rotate credentials after suspected exposure. Restrict `.env`, backups, Postgres data, artifacts, and logs to the service/operator accounts that need them. Do not publish the database port. Keep the API bound to loopback behind HTTPS. Use strong administrator passwords and protect the host login with your normal access controls.

The web MVP currently has one-time owner setup, local login, and organization-scoped access; it does not yet provide a complete account invitation or role-management console. Do not expose setup credentials or grant shared accounts casually. Review [Security and privacy](security-and-privacy.md) and `SECURITY.md`.

## Enroll and operate a collector

Install the Rust binary and systemd unit from the repository's deployment files. Run it as the dedicated `incidentatlas` service user, not root. Start in `dry-run`, inspect the proposed normalized events and redaction rule names, then use `local` mode to verify the bounded SQLite queue. Only switch to `connected` after reviewing source scope, confirming valid HTTPS, and establishing a tested backup copied off the monitored host.

Keep a narrow `sources.systemd_units` allowlist on shared hosts. Systemd collection uses structured lifecycle fields and does not upload journal message text. Docker collection is disabled by default: the Docker socket and `docker` group are effectively root access. Enabling Docker means explicitly accepting and documenting that privilege. Nginx watch currently polls only exact configured regular files, rejects symlinks, and emits their path and before/after hashes; it does not upload configuration contents or recursively scan directories. PostgreSQL operational collection, GitHub, and other planned connectors are not implemented in this build.

Store enrollment and collector credentials in separate protected files. The enrollment token is one-time; the server stores a hash of collector credentials and supports revocation. Never put credentials in TOML, command-line arguments, tickets, or shell history. Use `incidentatlas-agent doctor` to check local readiness without printing secret values.

Useful collector commands include `status`, `doctor`, `test-redaction`, `test-source systemd`, `test-source docker`, and `print-config`. The queue is durable and bounded; inspect its health/drop counters and local disk usage. Do not assume events were delivered merely because the agent process is running.

## Backups, retention, and legal holds

Back up PostgreSQL and the artifact volume together. Use `deploy/scripts/backup.sh <private-directory>` and validate a generated backup with `deploy/scripts/verify-backup.sh <backup-directory>`. These commands quiesce API/worker briefly; collectors buffer during the pause. Verification checks artifact digests and restores the database into a temporary database for table-count comparison. The scripts do not schedule backups, copy them off-host, or replace a full recovery rehearsal. Encrypt and copy verified backups to separate storage; test your restore procedure.

In **Retention & holds**, owners/admins can set event, artifact, audit, and reserved AI-generation windows independently. Shortening a period requires confirmation and queues asynchronous cleanup; legal holds protect covered evidence. A global hold covers the organization; an incident hold covers its configured time window. Give a clear reason when creating or releasing a hold. Expired artifact payloads are removed while metadata remains; downloads then return gone. Retention does not automatically delete incidents, hypotheses, holds, or accounts. AI-generation retention is reserved because AI generation storage is not implemented.

## Routine operations and incident response

Check `docker compose ps`, health endpoints, service logs, disk capacity, database volume, artifact volume, collector queues, and backup freshness. Application logs intentionally omit request bodies and credentials. If ingestion is unavailable, collectors should buffer locally; monitor overflow/drop signals and resolve the server or network issue before queue limits are reached.

For a suspected credential compromise: revoke the collector or user session/credential where supported, rotate affected secrets, preserve relevant logs and backups, review audit history, and investigate from a trusted host. For an upgrade, read release notes, take and verify a backup, apply the documented migrations through the normal deployment, then check health and restore capability.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

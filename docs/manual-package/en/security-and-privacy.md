# Security and privacy guide

## Collection promise

IncidentAtlas is designed to preserve compact state changes needed for reconstruction. The collector redacts before connected transmission. Current sources include structured systemd lifecycle events, opt-in Docker lifecycle metadata, and explicitly configured Nginx file hashes. The collector does not send journal message text, Docker environment variables, container logs, Nginx file contents, SQL text/parameters, application payloads, private keys, or repository source code.

This is a product design target, not a guarantee that every host or custom source is risk-free. Review event output in `dry-run`, scope sources, and use custom redaction patterns for local identifiers where needed.

## Data classes

| Class | Examples | Handling |
| --- | --- | --- |
| PUBLIC | Published software version | May be shared |
| OPERATIONAL | Service state, image digest, certificate expiry | Tenant-controlled operational record |
| SENSITIVE | Hostnames, file paths, user identifiers | Minimize, access-control, apply retention |
| SECRET | Passwords, tokens, private keys, cookies | Redact locally; never intentionally persist |
| PROHIBITED | Customer payloads, table rows, private-key contents | Do not collect |

## Operator safeguards

- Use `dry-run` before `local`, and `local` before `connected`.
- Run the agent with its dedicated unprivileged account and least access. Keep Docker disabled unless its root-equivalent privilege is accepted.
- Use HTTPS with certificate verification; do not disable TLS checks.
- Protect setup tokens, collector credentials, `.env`, backups, and database/artifact storage.
- Keep the database private and the public API behind HTTPS.
- Review generated event metadata and configured watch paths before enabling collection.
- Keep backups encrypted, off-host, and tested. Connected collection on a monitored host should wait until recovery copies and procedures are verified.
- Use retention limits and legal holds deliberately. Retention reductions can remove evidence asynchronously after confirmation.

## Access, integrity, and limitations

Tenant ownership is enforced by API queries. Collector credentials are stored as hashes and can be revoked. Events have SHA-256 digests; artifacts are digest-addressed and verified on cleanup/backup workflows. A digest detects certain changes to stored bytes; it does not prove that an event was truthful when a monitored host was compromised. Host clocks can be wrong, collectors can be offline, and a missing event is not evidence that a change did not occur.

Product analytics are off by default. The current MVP does not have a complete account-management interface, external identity provider, PostgreSQL event source, full config snapshots, automated off-host backup, or AI cause analysis. Review `docs/threat-model.md`, `docs/privacy.md`, and `SECURITY.md` for the detailed assumptions and vulnerability reporting process.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

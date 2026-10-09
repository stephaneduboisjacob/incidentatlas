# Deployment guide

This guide is a generic self-hosting outline. Replace the example hostname and paths with values for a domain and host you control. The deployment files in this repository are templates; they are not a record of a live environment.

## Requirements

- Linux host with Docker Compose and a supported Node.js 24 runtime.
- Rust toolchain for building the collector.
- PostgreSQL and an artifact store configured for the deployment.
- A protected environment file outside the repository.

## Deployment outline

1. Create a dedicated service account and install the application under a directory such as `/opt/incidentatlas`.
2. Configure PostgreSQL, the artifact store, API secrets, and a public origin through protected environment variables. Do not use the example tokens as production secrets.
3. Build the JavaScript workspaces and Rust collector from the checked-in lockfiles.
4. Run migrations using the migration role, then start the API, worker, and web application on private interfaces.
5. Configure Nginx or an equivalent reverse proxy with TLS for a domain you control. The sample configuration uses `incidentatlas.example.com`.
6. Install and enroll collectors in `dry-run` mode first. Review redaction rules and collector privileges before enabling connected mode.
7. Verify health checks, retention behavior, backup restore, audit records, and incident export procedures before connecting production hosts.

Do not upload real host inventories, production artifacts, credentials, private keys, or unredacted logs to GitHub issues or fixtures. Keep backups encrypted and access-controlled. See [the collector guide](collector.md), [privacy guide](privacy.md), and [threat model](threat-model.md).

## Contact

Stephane Jacob <jacobstephane@outlook.com>

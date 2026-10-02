# Security policy

IncidentAtlas handles operational evidence that may reveal sensitive
infrastructure details. Report suspected vulnerabilities privately to the
maintainers of this deployment or repository. Do not include real credentials,
private keys, customer payloads, or unredacted production artifacts in an issue
or test fixture.

## Security assumptions

- A monitored host and its collector may be compromised. The server must
  validate and bound all collector input.
- A collector token identifies one collector and can be revoked. Its database
  representation is a one-way cryptographic hash.
- Every tenant-owned lookup is authorized on the server using organization
  membership, not frontend filtering.
- Docker socket access is equivalent to highly privileged host access and is
  not enabled by default.
- Evidence artifacts are untrusted data. They are never executed or rendered
  as active HTML.
- Secrets must not be committed. `.env.example` contains placeholders only.

## Data handling

Redaction occurs locally before a connected collector transmits an event.
The server does not need application payloads, arbitrary SQL text, Docker
environment variables, TLS private keys, or source code to reconstruct
operational changes. See [docs/privacy.md](docs/privacy.md).

## Deployment

Use unique production secrets, TLS, supported releases, and backups. Keep the
collector unprivileged and grant each source only the access it needs. Review
the threat model in [docs/threat-model.md](docs/threat-model.md) before
enabling connectors.

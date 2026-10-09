# IncidentAtlas

A self-hostable operational change recorder for reconstructing what changed before an outage or security incident. It stores compact, redacted change events and evidence, then presents an explainable timeline for human investigation.

IncidentAtlas is not a bulk log platform, APM system, SIEM, or generic metrics dashboard. Its initial focus is Linux hosts and common operational systems such as systemd, Docker, Nginx, PostgreSQL, and GitHub.

## Project status

Early development. Interfaces and schemas may change before a stable release. Do not use this development build as the sole record of a production incident.

## Data flow

```text
Rust collector → bounded SQLite queue → authenticated API → PostgreSQL
                                             ↓                  ↓
                                      artifact store       worker/correlation
                                             ↓                  ↓
                                            React incident timeline
```

The collector is designed to redact data on the monitored host before transmission. Review [the privacy guidance](docs/privacy.md), [the threat model](docs/threat-model.md), and [SECURITY.md](SECURITY.md) before connecting a collector to a real system.

## Development

Requirements: Node.js 24, npm 11, Rust/Cargo, and Docker Compose. Start with the local configuration in `.env.example`, then follow [the development guide](docs/development.md). The deployment examples are templates and must be adapted to your environment.

## Documentation

- [Architecture](docs/architecture.md)
- [Event model](docs/event-model.md)
- [Collector support](docs/collector.md)
- [Development setup](docs/development.md)
- [Deployment guide](docs/deployment.md)
- [Privacy and retention](docs/privacy.md), [retention model](docs/retention.md), and [threat model](docs/threat-model.md)
- [Multilingual manuals](docs/manual-package/README.md)

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance and [SECURITY.md](SECURITY.md) for vulnerability reporting.

## License

No license has been selected yet. Public visibility does not grant permission to reuse the code.

## Contact

Stephane Jacob <jacobstephane@outlook.com>

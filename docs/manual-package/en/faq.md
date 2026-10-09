# Frequently asked questions

## What is IncidentAtlas?

A self-hostable operational change recorder that helps people reconstruct the timeline around an outage or security incident.

## Is it a log platform, APM, SIEM, or metrics dashboard?

No. Its focus is compact changes and evidence links, not arbitrary log shipping, tracing, security event detection, or general metrics.

## What can the current collector record?

The current build supports structured systemd unit lifecycle events, opt-in Docker container lifecycle events, and hashes for explicitly configured Nginx files. Docker is off by default. PostgreSQL operational collection, GitHub deployment collection, certificate metadata, and external status sources are planned, not available in this build.

## Does it upload configuration files, SQL, or container secrets?

The current Nginx watcher sends configured paths and SHA-256 before/after hashes, not file contents. Systemd does not upload journal message text. Docker environment variables and logs are excluded. PostgreSQL query text and parameters are not collected by the current build.

## Does IncidentAtlas identify the root cause?

No. Its deterministic scorer prioritizes events using explainable factors. These are hypotheses, not probabilities or proof. A human must review evidence and explicitly confirm a finding.

## Does it require an AI service or Internet access?

No. The current correlation and postmortem draft are deterministic and local to the installation. Connected collectors need HTTPS access to the server; the core self-hosted workflow does not require an external AI provider.

## Where is evidence stored?

Normalized records and metadata are in PostgreSQL. Artifact payloads use a local digest-addressed filesystem store. The operator controls the server, storage, access policy, and backups.

## Can I use Docker collection safely without extra privileges?

Docker access is disabled by default because the Docker socket or `docker` group is effectively root-level access. Enable it only after assessing that privilege and documenting the host change.

## How do retention and legal holds work?

Owners/admins configure separate retention windows. Shortening them requires confirmation and starts background cleanup. A global or incident-specific legal hold protects covered evidence until an administrator releases it with a reason.

## Is it ready to be my only production evidence system?

No. This is an early-development build. Backups are operator-run, must be copied off-host, and require a tested recovery plan. Keep other operational records until the product's maturity and your recovery process meet your requirements.

## What is the license?

License selection is pending. The repository currently reserves all rights; do not assume redistribution rights. Check the repository for an updated license before using beyond evaluation.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

# Threat model

## Assets

Operational timelines, evidence artifacts, incident notes, account sessions,
collector credentials, organization boundaries, and host availability.

## Trust boundaries

The collector runs on a monitored host that may be compromised. The API treats
every request as untrusted. Tenant authorization is checked in server-side
queries. The artifact filesystem is private to the service. The host Nginx
terminates public TLS; the app listens only on loopback.

## Threats and mitigations

| Threat | Initial mitigation |
| --- | --- |
| Compromised host or malicious collector | Strict schema/size limits, authenticated collector identity, rate limits, no trust in tenant IDs, append-only event provenance |
| Stolen collector token | Hash at rest, collector-specific scope, revocation, TLS, rotate on enrollment policy |
| Stolen user session | Secure HttpOnly/SameSite cookies, CSRF controls, expiry/revocation, rate limiting, audit trail |
| Cross-tenant access | Organization membership in every tenant-scoped query; negative isolation tests |
| Secret leakage in telemetry | Local redaction, data minimization, dry-run/local modes, no Docker env or SQL text by default |
| Docker privilege escalation | Docker source disabled unless explicitly configured; socket treated as root-equivalent |
| SQL/command injection | Parameterized SQL; no shell execution for source collection |
| XSS or malicious artifact | Escape text, no active HTML rendering, download headers and conservative content types |
| CSRF | SameSite cookies plus origin/token protection on state-changing routes |
| Artifact traversal/symlinks | Server-generated IDs, digest paths, no client paths, safe open semantics, private root |
| SSRF | External checks deferred; later require HTTP(S), destination policy, redirect/size/time limits |
| Event flooding/disk exhaustion | Batch and body limits, per-collector throttles, bounded local queue, visible dropped-event telemetry |
| Timestamp manipulation/replay | Stable event IDs, observed and ingested times, skew health event, idempotent inserts |
| Forged causal evidence | Preserve source provenance and hashes; hypotheses explain links and remain human-reviewed |
| Compromised server | Limit collected data, protect host secrets, backups and audit trail; hashes detect changes but do not make a compromised server trustworthy |

## Residual risk

A compromised monitored host can falsify events before collection. Hashes
provide integrity checks after capture, not proof that a source was truthful.
Docker socket access materially increases the collector's privilege and must
remain an explicit operator choice.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

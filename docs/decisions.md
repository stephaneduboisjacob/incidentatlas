# Architecture decisions

This file records the choices that constrain the first implementation. New
decisions should be added as dated entries with context and consequences.

## 2026-10-02: npm workspaces and TypeScript services

**Decision:** Use npm workspaces on the installed Node 24 runtime. Use Fastify
5 for the API, React 19 with Vite 8 for the web app, and a separate TypeScript
worker. Pin direct dependencies exactly and commit `package-lock.json`.

**Context:** Node 24 and npm are installed; pnpm, Yarn, and Bun are not. Fastify
5 requires Node 20+, and Vite 8 requires Node 20.19+ or 22.12+, so the installed
runtime satisfies both. Sources: [Fastify v5 migration guide](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/),
[Vite guide](https://vite.dev/guide/).

**Consequences:** One package manager and a lockfile make self-hosting and
development repeatable. API and worker remain separate processes without
adding a message broker.

The Rust collector pins Clap 4.6.7, Reqwest 0.13.5 with Rustls, Rusqlite
0.40.2 with bundled SQLite, Serde 1.0.228, and the versions in
`collector/incidentatlas-agent/Cargo.toml`; `Cargo.lock` fixes transitive
versions.

The initial exact direct versions are Fastify 5.12.5, Vite 8.3.2, React 19.3.0,
PostgreSQL client `pg` 8.23.1, Zod 4.6.5, and TypeScript 6.0.3. `package-lock.json`
records the complete transitive dependency graph.

## 2026-10-02: explicit SQL and migrations

**Decision:** Use PostgreSQL with a small SQL client and checked-in numbered
migrations rather than ORM-driven schema generation.

**Context:** Tenant ownership and append-only event constraints must be
visible and reviewable. The first expected scale does not justify a separate
columnar database.

**Consequences:** Repository modules own queries and transactions. Schema
changes require a migration and a deliberate deployment step.

## 2026-10-02: local queue and modest deployment

**Decision:** Use SQLite for the collector queue, PostgreSQL for server state,
and a local digest-addressed artifact backend. Keep Docker socket access off by
default.

**Context:** Collectors must tolerate outages while staying small and safe.
The host already runs unrelated services and databases.

**Consequences:** Queue limits, retry visibility, artifact path safety, and
collector permissions are explicit responsibilities. Compose gets an isolated
database and loopback-only app port.

## 2026-10-02: explainable evidence before AI

**Decision:** The initial incident suggestions use deterministic correlation.
Every hypothesis evidence link has a relationship and human-readable reason;
only a human can set `confirmed_by_human`.

**Context:** Causal claims must remain reviewable and traceable to immutable
events.

**Consequences:** AI is deferred until the timeline and evidence contracts are
proven. Disabled AI is a normal operating mode.

## 2026-10-02: license deferred

**Decision:** Do not select a project license implicitly during initial
scaffolding.

**Context:** License choice affects downstream use and the planned community
and commercial boundaries.

**Consequences:** The repository currently states that rights are reserved;
maintainers must choose a license before publishing a usable release.

## 2026-10-02: Rust formatter and linter components

**Decision:** Install the official `rustfmt` and `clippy` rustup components for
the host's existing stable toolchain.

**Context:** Rust and Cargo were present, but the two components required by
the repository's stated formatting and lint commands were missing.

**Consequences:** This adds only compiler-matched developer tools; it does not
install a separate global runtime or application dependency.

## 2026-10-02: private database and scoped dogfood collector

**Decision:** Keep PostgreSQL private to the Compose network in the normal
deployment. Publish it on loopback only through `docker-compose.test.yml` for
integration tests. Use an explicit systemd unit allowlist on shared hosts,
keep Docker collection off, and keep the current host collector in local mode
until an off-host backup and recovery procedure is established.

**Context:** The development server hosts unrelated services. An initial
dry-run showed that unfiltered lifecycle changes include unrelated unit names;
the source now supports a narrow allowlist. The first server ingestion check
also confirmed that collector enrollment and revocation work. Automated
retention and operator-run backup/temporary-restore verification are
implemented; off-host scheduling and recovery remain operator responsibilities.

**Consequences:** The verified collector-to-API path is available, while new
host events remain in a bounded local queue. The first two startup events
already accepted by the server remain as evidence; that collector credential
has been revoked.

## 2026-10-02: bounded retention and legal holds

**Decision:** Run organization-scoped retention in bounded PostgreSQL worker
batches. Keep artifact metadata after payload expiry, and preserve event-linked
investigation notes while clearing references to deleted event bodies. A
global legal hold protects all organization evidence; an incident hold covers
the incident's configured time window and artifacts referenced by events in
that window.

**Context:** Self-hosted evidence stores need predictable storage limits and
auditable deletion. Hold creation/release must not race cleanup, and an
operator needs to distinguish expired evidence from a missing or unauthorized
artifact.

**Consequences:** Policy reductions require explicit confirmation and queue
cleanup. Hold changes serialize with cleanup on an organization-scoped lock.
Expired artifact downloads return `410 Gone`, with digest-addressed metadata
and cleanup audit records retained. PostgreSQL restore and artifact digest
verification can be exercised by the operator scripts; connected dogfooding
still waits for off-host backups.

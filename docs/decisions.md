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

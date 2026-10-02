# Retention and evidence lifecycle

The initial schema contains per-organization retention settings and legal-hold
records. The API and worker do not yet run automatic retention deletion or
enforce legal holds. The current MVP therefore retains events, audit records,
incidents, and artifacts until an operator handles them deliberately.

PostgreSQL metadata and the local artifact volume are separate persistent
stores. Back them up together and verify a restore before using the installation
as the sole incident record. No automated backup or restore job is configured
by the MVP.

The current host collector remains in `local` mode with a bounded SQLite
queue. It does not send new host events to the server until retention,
backup/restore, and collector revocation workflows are ready. Collector
credentials are revocable; revoked collectors remain in the database for
provenance.

Before implementing deletion, the worker must check active legal holds in the
same organization and write an audit event for every retention action. Event
and artifact policies should be applied independently. Legal-hold release and
administrative deletion require an explicit operator action and tenant-scoped
authorization.

# Contributing

Read the project README and the architecture, event-model, privacy, and threat-model documents before changing collection or redaction behavior. Open an issue with a concise description and a reproducible example before proposing a broad change.

Use the checked-in npm and Cargo lockfiles. Do not commit `.env`, credentials, private keys, real host inventories, production logs, customer payloads, or collected incident evidence. Use synthetic fixtures.

Available checks include `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `cargo fmt --check` in the Rust collector directory. Note which checks you ran.

No license has been selected yet; public visibility does not grant permission to reuse the code.

Contact: Stephane Jacob <jacobstephane@outlook.com>

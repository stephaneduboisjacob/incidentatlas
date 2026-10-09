# User manual

## What IncidentAtlas does

IncidentAtlas records compact operational changes and arranges them around an incident so a person can investigate what changed, when it changed, and what evidence supports a possible explanation. Its current suggestions use deterministic scoring. A suggestion is a hypothesis, never an automatic finding of cause.

## Sign in and workspace

Open your organization's IncidentAtlas HTTPS address and sign in with the account created during first-run setup. Ask an owner or administrator for access if you do not have an account; the current MVP does not include a self-service invitation or user-management screen. Use **Sign out** when finished, especially on a shared workstation.

The overview shows open incidents, recent changes, hosts seen in the current view, and basic ingestion health. Use **Refresh** to reload the workspace. A host appears after the server accepts an event from its collector.

## Review the change timeline

Choose **All recent events** to review the recent event list, or select an incident to load its configured time window. The default window is 60 minutes before and 30 minutes after the incident start. Select a host and a category to narrow the list. Times are displayed in your browser's local timezone; stored event times use UTC.

Select a timeline row to open **Evidence detail**. Review its source, resource, change type, severity, before/after state, correlation factors, and SHA-256 event digest. Treat the digest as an integrity check, not proof that the original host was trustworthy. Some event types contain only metadata or hashes and will not have a config snapshot.

## Declare an incident

Use **Declare incident** and provide a concise title, incident start time, severity, and affected service names. Choose the time when symptoms began, not when someone happened to open IncidentAtlas. The affected service names help the scorer identify resource matches. Create the incident window, then review the events surrounding it.

The MVP does not currently provide a full incident lifecycle editor. Record investigation context using notes and hypothesis feedback; operational incident status workflows remain limited.

## Evaluate possible contributors

Select **Analyze incident window**. IncidentAtlas ranks evidence using visible factors such as time proximity, affected-resource matches, event significance, and symptom language. The current engine is deterministic and does not use an LLM. Scores are prioritization values, not probabilities.

Open the linked event before making a judgment. Mark a hypothesis **Investigate**, **Reject**, or **Confirm** only when your evidence supports that decision. **Confirm** records `confirmed_by_human`; it is the only way a cause is marked human-confirmed. Add a note to an event to preserve your interpretation. A low score or missing hypothesis does not prove that no cause exists.

## Create a postmortem draft

Choose **Download deterministic postmortem draft** from an incident. The downloaded Markdown summarizes the incident and links its statements to event IDs and evidence digests. It is a starting document: review every statement, add customer impact and corrective actions, and distinguish confirmed findings from open questions before sharing it.

## Evidence availability

Events and artifacts follow separate retention periods. An expired artifact may remain visible as metadata but cannot be downloaded. If an investigation must preserve evidence, ask an owner or administrator to place the incident or organization under legal hold before retention removes it. Do not copy sensitive artifacts into unapproved locations.

## Good investigation practice

Start with the symptom time and affected service. Compare changes before and after that point, inspect source evidence, and actively consider contradictory evidence. Write down uncertainty. Treat collector timestamps, host identity, and evidence as operational records that may be incomplete or affected by a compromised host.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

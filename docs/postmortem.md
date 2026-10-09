# Postmortem draft

IncidentAtlas can download an offline Markdown draft from an incident. The
draft is built from the incident record, timeline events, and investigator
feedback; it does not call an AI provider or require network access beyond the
local IncidentAtlas API.

Timeline entries include their event ID. The evidence section includes the
stored SHA-256 digest. Only a hypothesis marked `confirmed_by_human` appears
under confirmed contributing factors. Rejected and unresolved suggestions are
kept in separate sections. Missing customer impact, corrective actions, and
follow-up items are clearly marked as unrecorded for a human to complete.

Generation writes an audit event with the template version and evidence
counts. User-provided strings are escaped for Markdown structure and are
downloaded as a file; the application does not render the draft as HTML.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

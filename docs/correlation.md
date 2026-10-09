# Deterministic correlation

The MVP scores events with a small deterministic function. It does not use an
LLM or claim to identify a root cause.

For each event in an incident time window, the engine currently adds:

- **Temporal proximity:** starts at 28 points and decreases by 0.7 points for
  each minute from the incident start; events outside the configured window
  receive no temporal points.
- **Resource relationship:** 30 points when the event resource matches an
  affected service name or ID.
- **Change significance:** a baseline by event type, including image changes,
  health changes, database saturation, deadlocks, service state, and Nginx
  configuration changes.
- **Symptom alignment:** 18 points when the event describes failure,
  saturation, unhealthy state, error, restart, degradation, or timeout.

Scores are the sum of these visible factors. Events are ranked by score and
then event ID for stable ordering. Timeline queries show all events in the
incident window with their factors. Hypothesis generation currently suggests
up to ten supporting events scoring at least 45 points and links each
hypothesis to its source event.

An event after incident start marked as a recovery is labeled contradicting
in the timeline. The initial scorer does not yet use dependency graphs,
historical user feedback, change rarity, or recovery alignment. Those are
future factors and must be added with explicit tests. A human alone can set a
hypothesis to `confirmed_by_human`.

This score is a prioritization aid. It is not a probability, an AI confidence,
or proof of causality.

---

Contact: Stephane Jacob <jacobstephane@outlook.com>

import assert from "node:assert/strict";
import test from "node:test";
import { rankEvents } from "./index.js";
import type { IncidentEvent } from "@incidentatlas/event-schema";

function event(overrides: Partial<IncidentEvent>): IncidentEvent {
  return {
    schema_version: 1,
    event_id: "4b123f88-6681-4933-9081-3f8d9a2758a1",
    occurred_at: "2026-10-02T12:05:00Z",
    observed_at: "2026-10-02T12:05:01Z",
    source: "postgres",
    category: "database",
    type: "database.connection_saturation",
    severity: "error",
    change_kind: "threshold_crossed",
    resource: { type: "database", id: "primary", name: "primary" },
    summary: "Database connections reached saturation",
    before: {},
    after: { state: "saturated" },
    attributes: {},
    evidence: [],
    privacy: { redaction_applied: true, redaction_ruleset: "test" },
    ...overrides,
  };
}

test("resource and symptom relevance outweigh a closer irrelevant config edit", () => {
  const ranked = rankEvents([
    event({
      event_id: "4b123f88-6681-4933-9081-3f8d9a2758a2",
      occurred_at: "2026-10-02T12:00:00Z",
      source: "nginx",
      category: "configuration",
      type: "nginx.config_changed",
      severity: "info",
      change_kind: "update",
      resource: { type: "file", id: "/etc/nginx/nginx.conf", name: "nginx.conf" },
      summary: "Nginx comment changed",
    }),
    event({}),
  ], {
    id: "incident-1",
    startedAt: "2026-10-02T12:06:00Z",
    windowBeforeMinutes: 60,
    windowAfterMinutes: 30,
    affectedServices: ["api"],
  });

  assert.equal(ranked[0]?.eventId, "4b123f88-6681-4933-9081-3f8d9a2758a1");
});

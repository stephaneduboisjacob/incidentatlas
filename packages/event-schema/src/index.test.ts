import assert from "node:assert/strict";
import test from "node:test";
import { EventSchema } from "./index.js";

const valid = {
  schema_version: 1,
  event_id: "4b123f88-6681-4933-9081-3f8d9a2758a1",
  occurred_at: "2026-10-02T18:00:00Z",
  observed_at: "2026-10-02T18:00:01Z",
  source: "systemd",
  category: "process",
  type: "systemd.service_state_changed",
  severity: "warning",
  change_kind: "failure",
  resource: { type: "service", id: "nginx.service", name: "nginx" },
  summary: "nginx.service transitioned from active to failed",
  before: { state: "active" },
  after: { state: "failed" },
  attributes: {},
  privacy: { redaction_applied: true, redaction_ruleset: "default-v1" },
};

test("accepts a normalized redacted event", () => {
  assert.equal(EventSchema.parse(valid).event_id, valid.event_id);
});

test("rejects unsupported taxonomy and missing redaction marker", () => {
  assert.equal(EventSchema.safeParse({ ...valid, category: "logs" }).success, false);
  assert.equal(EventSchema.safeParse({ ...valid, privacy: { redaction_applied: false, redaction_ruleset: "default" } }).success, false);
});

test("rejects unrecognized fields instead of persisting unchecked payloads", () => {
  assert.equal(EventSchema.safeParse({ ...valid, organization_id: "attacker-controlled" }).success, false);
});

import { z } from "zod";

export const EVENT_CATEGORIES = [
  "deployment",
  "configuration",
  "process",
  "container",
  "database",
  "network",
  "authentication",
  "certificate",
  "resource",
  "external",
  "customer",
  "security",
  "collector",
  "manual",
] as const;

export const CHANGE_KINDS = [
  "create",
  "update",
  "delete",
  "start",
  "stop",
  "restart",
  "failure",
  "recovery",
  "threshold_crossed",
  "anomaly",
  "manual_annotation",
] as const;

const JsonObjectSchema = z.record(z.string().max(128), z.unknown());

export const EventSchema = z.object({
  schema_version: z.literal(1),
  event_id: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
  observed_at: z.iso.datetime({ offset: true }),
  source: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/),
  category: z.enum(EVENT_CATEGORIES),
  type: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
  severity: z.enum(["debug", "info", "warning", "error", "critical"]),
  change_kind: z.enum(CHANGE_KINDS),
  actor: z.object({
    type: z.enum(["user", "service", "system", "unknown"]),
    id: z.string().max(256).optional(),
    display: z.string().max(256).optional(),
  }).strict().optional(),
  resource: z.object({
    type: z.string().min(1).max(64),
    id: z.string().min(1).max(512),
    name: z.string().max(256).optional(),
  }).strict(),
  summary: z.string().min(1).max(512),
  before: JsonObjectSchema.default({}),
  after: JsonObjectSchema.default({}),
  attributes: JsonObjectSchema.default({}),
  evidence: z.array(z.object({
    artifact_id: z.uuid(),
    kind: z.string().min(1).max(64),
  }).strict()).max(32).default([]),
  correlation: z.object({
    fingerprint: z.string().max(128).optional(),
  }).strict().optional(),
  privacy: z.object({
    redaction_applied: z.literal(true),
    redaction_ruleset: z.string().min(1).max(64),
  }).strict(),
}).strict();

export const EventBatchSchema = z.object({
  schema_version: z.literal(1),
  events: z.array(EventSchema).min(1).max(100),
}).strict();

export type IncidentEvent = z.infer<typeof EventSchema>;
export type IncidentEventBatch = z.infer<typeof EventBatchSchema>;

export const EVENT_SCHEMA_VERSION = 1 as const;

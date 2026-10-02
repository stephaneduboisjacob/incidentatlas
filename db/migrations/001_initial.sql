CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO organizations (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'default', 'IncidentAtlas')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'read_only')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash bytea NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hosts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  machine_id_hash text NOT NULL,
  hostname text NOT NULL,
  operating_system text NOT NULL,
  kernel text NOT NULL DEFAULT '',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, machine_id_hash)
);

CREATE TABLE collectors (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  host_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  agent_version text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_clock_skew_event_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (organization_id, host_id) REFERENCES hosts(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, host_id, id)
);

CREATE TABLE incidents (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'investigating', 'mitigated', 'resolved', 'closed')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  started_at timestamptz NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  time_window_before interval NOT NULL DEFAULT interval '60 minutes',
  time_window_after interval NOT NULL DEFAULT interval '30 minutes',
  affected_services jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  host_id uuid NOT NULL,
  collector_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  category text NOT NULL CHECK (category IN ('deployment', 'configuration', 'process', 'container', 'database', 'network', 'authentication', 'certificate', 'resource', 'external', 'customer', 'security', 'collector', 'manual')),
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
  change_kind text NOT NULL CHECK (change_kind IN ('create', 'update', 'delete', 'start', 'stop', 'restart', 'failure', 'recovery', 'threshold_crossed', 'anomaly', 'manual_annotation')),
  actor jsonb,
  resource jsonb NOT NULL,
  summary text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation jsonb,
  redaction_ruleset text NOT NULL,
  event_digest char(64) NOT NULL,
  agent_version text NOT NULL,
  FOREIGN KEY (organization_id, host_id) REFERENCES hosts(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, host_id, collector_id) REFERENCES collectors(organization_id, host_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE INDEX events_org_time_idx ON events (organization_id, occurred_at DESC, id);
CREATE INDEX events_org_host_time_idx ON events (organization_id, host_id, occurred_at DESC);
CREATE INDEX events_org_category_time_idx ON events (organization_id, category, occurred_at DESC);
CREATE INDEX events_attributes_gin_idx ON events USING gin (attributes);

CREATE TABLE artifacts (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  sha256 char(64) NOT NULL,
  object_key text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  source text NOT NULL,
  redaction_status text NOT NULL CHECK (redaction_status IN ('redacted', 'not_applicable', 'pending')),
  retention_class text NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, sha256)
);

CREATE TABLE hypotheses (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('suggested', 'investigating', 'rejected', 'contributing', 'confirmed_by_human')),
  generated_by text NOT NULL CHECK (generated_by IN ('deterministic', 'human', 'ai')),
  confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  source_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, incident_id) REFERENCES incidents(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, source_event_id) REFERENCES events(organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, id)
);

CREATE UNIQUE INDEX hypotheses_source_event_uq ON hypotheses (organization_id, incident_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE TABLE hypothesis_evidence (
  organization_id uuid NOT NULL,
  hypothesis_id uuid NOT NULL,
  event_id uuid NOT NULL,
  relationship text NOT NULL CHECK (relationship IN ('supporting', 'contradicting', 'contextual')),
  weight numeric(7,4) NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hypothesis_id, event_id, relationship),
  FOREIGN KEY (organization_id, hypothesis_id) REFERENCES hypotheses(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, event_id) REFERENCES events(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE annotations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  event_id uuid,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, incident_id) REFERENCES incidents(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, event_id) REFERENCES events(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX audit_events_org_time_idx ON audit_events (organization_id, occurred_at DESC);

CREATE TABLE retention_policies (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  event_days integer NOT NULL DEFAULT 90 CHECK (event_days > 0),
  artifact_days integer NOT NULL DEFAULT 30 CHECK (artifact_days > 0),
  audit_days integer NOT NULL DEFAULT 365 CHECK (audit_days > 0),
  ai_generation_days integer NOT NULL DEFAULT 30 CHECK (ai_generation_days > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legal_holds (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  incident_id uuid,
  reason text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  FOREIGN KEY (organization_id, incident_id) REFERENCES incidents(organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE jobs (
  id bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  job_type text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'complete', 'failed')),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  locked_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX jobs_ready_idx ON jobs (available_at, id) WHERE state = 'queued';
CREATE UNIQUE INDEX jobs_active_correlation_uq ON jobs (organization_id, (payload->>'incident_id'))
  WHERE job_type = 'correlation.rebuild' AND state IN ('queued', 'running');

INSERT INTO retention_policies (organization_id)
VALUES ('00000000-0000-4000-8000-000000000001')
ON CONFLICT (organization_id) DO NOTHING;

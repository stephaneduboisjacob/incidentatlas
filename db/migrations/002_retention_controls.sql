ALTER TABLE artifacts
  ADD COLUMN purged_at timestamptz,
  ADD COLUMN purge_reason text,
  ADD CONSTRAINT artifacts_purge_state_check CHECK (
    (purged_at IS NULL AND purge_reason IS NULL)
    OR (purged_at IS NOT NULL AND purge_reason IS NOT NULL AND purge_reason = 'retention_policy')
  );

ALTER TABLE legal_holds
  ADD COLUMN released_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN release_reason text,
  ADD CONSTRAINT legal_holds_release_state_check CHECK (
    (released_at IS NULL AND released_by IS NULL AND release_reason IS NULL)
    OR (released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL
        AND length(release_reason) BETWEEN 1 AND 2000)
  );

CREATE INDEX artifacts_retention_idx ON artifacts (organization_id, created_at, id) WHERE purged_at IS NULL;
CREATE INDEX legal_holds_active_idx ON legal_holds (organization_id, incident_id) WHERE released_at IS NULL;
CREATE UNIQUE INDEX jobs_active_retention_uq ON jobs (organization_id)
  WHERE job_type = 'retention.sweep' AND state IN ('queued', 'running');

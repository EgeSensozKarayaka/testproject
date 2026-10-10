-- migrate:transaction true

-- Long-lived state and incident lineage must not keep the much wider raw run
-- partitions alive. This compact evidence row preserves only the immutable
-- fields required to prove what observation caused a transition.
CREATE TABLE monitoring.run_evidence (
  finished_at timestamptz NOT NULL,
  id uuid NOT NULL,
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  outcome text NOT NULL,
  failure_category text,
  total_ms integer NOT NULL,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (owner_id, check_id, finished_at, id),
  CONSTRAINT run_evidence_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT run_evidence_outcome_valid CHECK (outcome IN ('PASS', 'FAIL')),
  CONSTRAINT run_evidence_failure_consistent CHECK (
    (outcome = 'PASS' AND failure_category IS NULL)
    OR (outcome = 'FAIL' AND failure_category IS NOT NULL)
  ),
  CONSTRAINT run_evidence_total_ms_valid CHECK (total_ms >= 0)
);

CREATE INDEX run_evidence_unreferenced_purge_idx
  ON monitoring.run_evidence (created_at, owner_id, check_id, finished_at, id);

-- Only locators already referenced by durable state require historical
-- backfill. All accepted runs written after this migration are captured by the
-- trigger below. This avoids copying the complete raw-run retention window in
-- one schema migration.
WITH referenced_runs AS (
  SELECT owner_id, check_id, first_failure_run_finished_at AS finished_at,
         first_failure_run_id AS id
  FROM monitoring.incidents
  UNION
  SELECT owner_id, check_id, confirmation_run_finished_at, confirmation_run_id
  FROM monitoring.incidents
  UNION
  SELECT owner_id, check_id, start_run_finished_at, start_run_id
  FROM monitoring.incident_segments
  UNION
  SELECT owner_id, check_id, end_run_finished_at, end_run_id
  FROM monitoring.incident_segments
  WHERE end_run_id IS NOT NULL
  UNION
  SELECT owner_id, check_id, candidate_run_finished_at, candidate_run_id
  FROM monitoring.check_current_states
  WHERE candidate_run_id IS NOT NULL
  UNION
  SELECT owner_id, check_id, last_accepted_run_finished_at, last_accepted_run_id
  FROM monitoring.check_current_states
  WHERE last_accepted_run_id IS NOT NULL
  UNION
  SELECT owner_id, check_id, source_run_finished_at, source_run_id
  FROM monitoring.open_health_intervals
  WHERE source_run_id IS NOT NULL
  UNION
  SELECT owner_id, check_id, source_run_finished_at, source_run_id
  FROM monitoring.health_intervals
  WHERE source_run_id IS NOT NULL
)
INSERT INTO monitoring.run_evidence (
  finished_at, id, owner_id, check_id, outcome, failure_category,
  total_ms, recorded_at
)
SELECT run.finished_at, run.id, run.owner_id, run.check_id, run.outcome,
       run.failure_category, run.total_ms, run.recorded_at
FROM referenced_runs AS reference
JOIN monitoring.check_runs AS run
  ON run.owner_id = reference.owner_id
 AND run.check_id = reference.check_id
 AND run.finished_at = reference.finished_at
 AND run.id = reference.id
WHERE run.accepted_for_state
ON CONFLICT (owner_id, check_id, finished_at, id) DO NOTHING;

DO $assert_evidence_backfill$
BEGIN
  IF EXISTS (
    WITH referenced_runs AS (
      SELECT owner_id, check_id, first_failure_run_finished_at AS finished_at,
             first_failure_run_id AS id
      FROM monitoring.incidents
      UNION
      SELECT owner_id, check_id, confirmation_run_finished_at, confirmation_run_id
      FROM monitoring.incidents
      UNION
      SELECT owner_id, check_id, start_run_finished_at, start_run_id
      FROM monitoring.incident_segments
      UNION
      SELECT owner_id, check_id, end_run_finished_at, end_run_id
      FROM monitoring.incident_segments
      WHERE end_run_id IS NOT NULL
      UNION
      SELECT owner_id, check_id, candidate_run_finished_at, candidate_run_id
      FROM monitoring.check_current_states
      WHERE candidate_run_id IS NOT NULL
      UNION
      SELECT owner_id, check_id, last_accepted_run_finished_at, last_accepted_run_id
      FROM monitoring.check_current_states
      WHERE last_accepted_run_id IS NOT NULL
      UNION
      SELECT owner_id, check_id, source_run_finished_at, source_run_id
      FROM monitoring.open_health_intervals
      WHERE source_run_id IS NOT NULL
      UNION
      SELECT owner_id, check_id, source_run_finished_at, source_run_id
      FROM monitoring.health_intervals
      WHERE source_run_id IS NOT NULL
    )
    SELECT 1
    FROM referenced_runs AS reference
    LEFT JOIN monitoring.run_evidence AS evidence
      ON evidence.owner_id = reference.owner_id
     AND evidence.check_id = reference.check_id
     AND evidence.finished_at = reference.finished_at
     AND evidence.id = reference.id
    WHERE evidence.id IS NULL
  ) THEN
    RAISE EXCEPTION 'run evidence backfill is incomplete or references a rejected run'
      USING ERRCODE = '23514';
  END IF;
END
$assert_evidence_backfill$;

-- The queue rows may be removed before the raw run partition. Preserve the
-- same owner/check/job/attempt invariant at write time and take key-share locks
-- so a concurrent purge cannot invalidate a successful validation.
CREATE FUNCTION monitoring.validate_check_run_lineage_and_capture_evidence()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  PERFORM 1
  FROM monitoring.check_jobs AS job
  JOIN monitoring.check_job_attempts AS attempt
    ON attempt.owner_id = job.owner_id
   AND attempt.check_id = job.check_id
   AND attempt.job_id = job.id
  WHERE job.owner_id = NEW.owner_id
    AND job.check_id = NEW.check_id
    AND job.id = NEW.job_id
    AND attempt.id = NEW.attempt_id
    AND attempt.fencing_token = NEW.fencing_token
  FOR KEY SHARE OF job, attempt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'check run queue lineage does not exist or does not match'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.accepted_for_state THEN
    INSERT INTO monitoring.run_evidence (
      finished_at, id, owner_id, check_id, outcome, failure_category,
      total_ms, recorded_at
    ) VALUES (
      NEW.finished_at, NEW.id, NEW.owner_id, NEW.check_id, NEW.outcome,
      NEW.failure_category, NEW.total_ms, NEW.recorded_at
    );
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION monitoring.validate_check_run_lineage_and_capture_evidence() FROM PUBLIC;

CREATE TRIGGER check_runs_validate_lineage_and_capture_evidence
BEFORE INSERT ON monitoring.check_runs
FOR EACH ROW EXECUTE FUNCTION monitoring.validate_check_run_lineage_and_capture_evidence();

-- Contract the old retention-blocking foreign keys only after the replacement
-- invariant and evidence backfill are in place.
ALTER TABLE monitoring.check_runs
  DROP CONSTRAINT check_runs_job_fk,
  DROP CONSTRAINT check_runs_attempt_fk;

ALTER TABLE monitoring.incidents
  DROP CONSTRAINT incidents_first_run_fk,
  DROP CONSTRAINT incidents_confirmation_run_fk,
  ADD CONSTRAINT incidents_first_run_fk FOREIGN KEY (
    owner_id, check_id, first_failure_run_finished_at, first_failure_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT incidents_confirmation_run_fk FOREIGN KEY (
    owner_id, check_id, confirmation_run_finished_at, confirmation_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT;

ALTER TABLE monitoring.incident_segments
  DROP CONSTRAINT incident_segments_start_run_fk,
  DROP CONSTRAINT incident_segments_end_run_fk,
  ADD CONSTRAINT incident_segments_start_run_fk FOREIGN KEY (
    owner_id, check_id, start_run_finished_at, start_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT incident_segments_end_run_fk FOREIGN KEY (
    owner_id, check_id, end_run_finished_at, end_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT;

ALTER TABLE monitoring.check_current_states
  DROP CONSTRAINT check_current_states_candidate_run_fk,
  DROP CONSTRAINT check_current_states_last_run_fk,
  ADD CONSTRAINT check_current_states_candidate_run_fk FOREIGN KEY (
    owner_id, check_id, candidate_run_finished_at, candidate_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT,
  ADD CONSTRAINT check_current_states_last_run_fk FOREIGN KEY (
    owner_id, check_id, last_accepted_run_finished_at, last_accepted_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT;

ALTER TABLE monitoring.open_health_intervals
  DROP CONSTRAINT open_health_intervals_source_run_fk,
  ADD CONSTRAINT open_health_intervals_source_run_fk FOREIGN KEY (
    owner_id, check_id, source_run_finished_at, source_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT;

ALTER TABLE monitoring.health_intervals
  DROP CONSTRAINT health_intervals_source_run_fk,
  ADD CONSTRAINT health_intervals_source_run_fk FOREIGN KEY (
    owner_id, check_id, source_run_finished_at, source_run_id
  ) REFERENCES monitoring.run_evidence (
    owner_id, check_id, finished_at, id
  ) ON DELETE RESTRICT;

-- Preserve the group visible at incident-open time. The trigger keeps a rolling
-- deployment safe while older monitor processes are still running.
ALTER TABLE monitoring.incidents
  ADD COLUMN group_id_at_open uuid;

UPDATE monitoring.incidents AS incident
SET group_id_at_open = check_row.group_id
FROM app.checks AS check_row
WHERE check_row.owner_id = incident.owner_id
  AND check_row.id = incident.check_id;

ALTER TABLE monitoring.incidents
  ADD CONSTRAINT incidents_group_at_open_fk FOREIGN KEY (owner_id, group_id_at_open)
    REFERENCES app.check_groups (owner_id, id) ON DELETE RESTRICT;

CREATE INDEX incidents_owner_group_started_idx
  ON monitoring.incidents (owner_id, group_id_at_open, started_at DESC, id)
  WHERE group_id_at_open IS NOT NULL;

CREATE FUNCTION monitoring.capture_incident_group_at_open()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  SELECT check_row.group_id
  INTO NEW.group_id_at_open
  FROM app.checks AS check_row
  WHERE check_row.owner_id = NEW.owner_id
    AND check_row.id = NEW.check_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'incident check does not exist'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION monitoring.capture_incident_group_at_open() FROM PUBLIC;

CREATE TRIGGER incidents_capture_group_at_open
BEFORE INSERT ON monitoring.incidents
FOR EACH ROW EXECUTE FUNCTION monitoring.capture_incident_group_at_open();

-- Durable cursors use a complete tie-break tuple. The existing watermark is
-- retained as the source recorded_at/finalized_at component.
ALTER TABLE monitoring.rollup_checkpoints
  ADD COLUMN cursor_owner_id uuid,
  ADD COLUMN cursor_check_id uuid,
  ADD COLUMN cursor_source_at timestamptz,
  ADD COLUMN cursor_source_id uuid,
  ADD COLUMN data_through timestamptz,
  ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  ADD CONSTRAINT rollup_checkpoints_cursor_consistent CHECK (
    num_nonnulls(cursor_owner_id, cursor_check_id, cursor_source_at, cursor_source_id) IN (0, 4)
  );

CREATE TABLE monitoring.rollup_rebuild_ranges (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  resolution text NOT NULL,
  range_start timestamptz NOT NULL,
  range_end timestamptz NOT NULL,
  next_bucket_start timestamptz NOT NULL,
  reason text NOT NULL,
  source_fingerprint bytea NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT rollup_rebuild_ranges_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT rollup_rebuild_ranges_source_unique UNIQUE (
    owner_id, check_id, resolution, source_fingerprint
  ),
  CONSTRAINT rollup_rebuild_ranges_resolution_valid CHECK (
    resolution IN ('MINUTE', 'HOUR')
  ),
  CONSTRAINT rollup_rebuild_ranges_reason_valid CHECK (
    reason IN ('RUN_RECORDED', 'INTERVAL_FINALIZED', 'MINUTE_CHANGED', 'BACKFILL', 'REPAIR')
  ),
  CONSTRAINT rollup_rebuild_ranges_state_valid CHECK (
    state IN ('PENDING', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT rollup_rebuild_ranges_fingerprint_valid CHECK (
    octet_length(source_fingerprint) = 32
  ),
  CONSTRAINT rollup_rebuild_ranges_range_valid CHECK (
    range_end > range_start
    AND next_bucket_start >= range_start
    AND next_bucket_start <= range_end
  ),
  CONSTRAINT rollup_rebuild_ranges_attempt_valid CHECK (attempt_count >= 0),
  CONSTRAINT rollup_rebuild_ranges_error_valid CHECK (
    last_error_code IS NULL
    OR (btrim(last_error_code) <> '' AND octet_length(last_error_code) <= 128)
  ),
  CONSTRAINT rollup_rebuild_ranges_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE INDEX rollup_rebuild_ranges_pending_idx
  ON monitoring.rollup_rebuild_ranges (resolution, created_at, id)
  WHERE state = 'PENDING';
CREATE INDEX rollup_rebuild_ranges_check_range_idx
  ON monitoring.rollup_rebuild_ranges (owner_id, check_id, resolution, range_start, range_end)
  WHERE state <> 'COMPLETED';

CREATE TABLE infra.partition_retention_runs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  parent_relation text NOT NULL,
  child_schema text NOT NULL,
  child_name text NOT NULL,
  partition_start timestamptz NOT NULL,
  partition_end timestamptz NOT NULL,
  row_count bigint NOT NULL CHECK (row_count >= 0),
  state text NOT NULL DEFAULT 'DISCOVERED',
  detached_at timestamptz,
  drop_after timestamptz,
  dropped_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT partition_retention_parent_valid CHECK (
    parent_relation IN (
      'monitoring.check_runs',
      'monitoring.health_intervals',
      'monitoring.rollups_minute',
      'monitoring.rollups_hour'
    )
  ),
  CONSTRAINT partition_retention_identifier_valid CHECK (
    child_schema ~ '^[a-z_][a-z0-9_]*$'
    AND child_name ~ '^[a-z_][a-z0-9_]*$'
  ),
  CONSTRAINT partition_retention_range_valid CHECK (partition_end > partition_start),
  CONSTRAINT partition_retention_state_valid CHECK (
    state IN ('DISCOVERED', 'DETACHED', 'DROPPED', 'FAILED', 'CANCELLED')
  ),
  CONSTRAINT partition_retention_lifecycle_consistent CHECK (
    (state = 'DISCOVERED' AND detached_at IS NULL AND drop_after IS NULL AND dropped_at IS NULL)
    OR (state IN ('DETACHED', 'FAILED') AND detached_at IS NOT NULL AND drop_after IS NOT NULL AND dropped_at IS NULL)
    OR (state = 'DROPPED' AND detached_at IS NOT NULL AND drop_after IS NOT NULL AND dropped_at IS NOT NULL)
    OR (state = 'CANCELLED' AND dropped_at IS NULL)
  ),
  CONSTRAINT partition_retention_error_valid CHECK (
    last_error_code IS NULL
    OR (btrim(last_error_code) <> '' AND octet_length(last_error_code) <= 128)
  ),
  CONSTRAINT partition_retention_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX partition_retention_one_active_child_idx
  ON infra.partition_retention_runs (child_schema, child_name)
  WHERE state IN ('DISCOVERED', 'DETACHED', 'FAILED');
CREATE INDEX partition_retention_due_drop_idx
  ON infra.partition_retention_runs (drop_after, id)
  WHERE state = 'DETACHED';

-- Source discovery follows persistence time, not domain time, and uses the
-- exact tuple stored in rollup_checkpoints.
CREATE INDEX check_runs_rollup_discovery_idx
  ON monitoring.check_runs (recorded_at, owner_id, check_id, finished_at, id)
  WHERE accepted_for_state;
CREATE INDEX health_intervals_rollup_discovery_idx
  ON monitoring.health_intervals (finalized_at, owner_id, check_id, started_at, id);

ALTER TABLE monitoring.run_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring.run_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE monitoring.rollup_rebuild_ranges ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring.rollup_rebuild_ranges FORCE ROW LEVEL SECURITY;

CREATE POLICY schema_owner_all ON monitoring.run_evidence
  TO site_monitor_schema_owner
  USING (true)
  WITH CHECK (true);
CREATE POLICY schema_owner_all ON monitoring.rollup_rebuild_ranges
  TO site_monitor_schema_owner
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON monitoring.run_evidence FROM PUBLIC;
REVOKE ALL ON monitoring.rollup_rebuild_ranges FROM PUBLIC;
REVOKE ALL ON infra.partition_retention_runs FROM PUBLIC;

COMMENT ON TABLE monitoring.run_evidence IS
  'Compact accepted-run lineage retained independently from raw check-run partitions.';
COMMENT ON TABLE monitoring.rollup_rebuild_ranges IS
  'Durable bounded ranges awaiting deterministic minute or hour recomputation.';
COMMENT ON TABLE infra.partition_retention_runs IS
  'Operational detach/grace/drop manifest; not a replacement for audit events.';
COMMENT ON COLUMN monitoring.incidents.group_id_at_open IS
  'Best-effort backfill for pre-revision-21 rows; exact immutable snapshot for new incidents.';

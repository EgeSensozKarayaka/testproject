-- migrate:transaction true

-- Preserve the request-time semantics of a coalesced manual run. Existing
-- pending intents were created from the check's execution state, so that state
-- is the only safe forward backfill source.
ALTER TABLE app.checks
  ADD COLUMN manual_requested_mode text;

UPDATE app.checks
SET manual_requested_mode = CASE execution_state
  WHEN 'ACTIVE' THEN 'STATEFUL'
  ELSE 'DIAGNOSTIC'
END
WHERE manual_requested_at IS NOT NULL;

ALTER TABLE app.checks
  ADD CONSTRAINT checks_manual_request_consistent CHECK (
    (manual_requested_at IS NULL AND manual_requested_mode IS NULL)
    OR (
      manual_requested_at IS NOT NULL
      AND manual_requested_mode IN ('STATEFUL', 'DIAGNOSTIC')
    )
  );

-- A leased/running job remains active until the worker acknowledges
-- cancellation. This keeps the one-active-job invariant in force while the
-- external request is still being aborted.
ALTER TABLE monitoring.check_jobs
  ADD COLUMN cancellation_requested_at timestamptz,
  ADD COLUMN cancellation_reason text;

ALTER TABLE monitoring.check_jobs
  ADD CONSTRAINT check_jobs_cancellation_consistent CHECK (
    (cancellation_requested_at IS NULL AND cancellation_reason IS NULL)
    OR (
      cancellation_requested_at IS NOT NULL
      AND cancellation_reason IN ('CHECK_PAUSED', 'CHECK_DELETED', 'CONFIGURATION_CHANGED')
      AND state IN ('LEASED', 'RUNNING', 'CANCELLED')
    )
  );

-- Old API cancellation could leave lease metadata on terminal jobs. Normalize
-- it once, then enforce a complete state/lease shape for all future writers.
UPDATE monitoring.check_jobs
SET lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    fencing_token = NULL
WHERE state NOT IN ('LEASED', 'RUNNING');

ALTER TABLE monitoring.check_jobs
  ADD CONSTRAINT check_jobs_runtime_state_consistent CHECK (
    (
      state = 'PENDING'
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL
      AND fencing_token IS NULL
      AND started_at IS NULL
    )
    OR (
      state = 'LEASED'
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND heartbeat_at IS NOT NULL
      AND fencing_token IS NOT NULL
      AND started_at IS NULL
    )
    OR (
      state = 'RUNNING'
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND heartbeat_at IS NOT NULL
      AND fencing_token IS NOT NULL
      AND started_at IS NOT NULL
    )
    OR (
      state IN ('COMPLETED', 'CANCELLED', 'DEAD')
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL
      AND fencing_token IS NULL
    )
  );

-- Keep the exact partition key locator on the attempt. Duplicate persistence
-- can then find the immutable run without scanning every monthly partition.
ALTER TABLE monitoring.check_job_attempts
  ADD COLUMN result_run_finished_at timestamptz,
  ADD COLUMN result_run_id uuid;

DO $result_uniqueness$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM monitoring.check_runs
    GROUP BY owner_id, check_id, job_id, attempt_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'multiple check_runs exist for one attempt';
  END IF;
END
$result_uniqueness$;

UPDATE monitoring.check_job_attempts AS attempt
SET result_run_finished_at = run.finished_at,
    result_run_id = run.id
FROM monitoring.check_runs AS run
WHERE attempt.owner_id = run.owner_id
  AND attempt.check_id = run.check_id
  AND attempt.job_id = run.job_id
  AND attempt.id = run.attempt_id
  AND attempt.result_recorded_at IS NOT NULL;

ALTER TABLE monitoring.check_job_attempts
  ADD CONSTRAINT check_job_attempts_result_pointer_consistent CHECK (
    num_nonnulls(result_recorded_at, result_run_finished_at, result_run_id) IN (0, 3)
  ),
  ADD CONSTRAINT check_job_attempts_result_run_fk FOREIGN KEY (
    owner_id,
    check_id,
    result_run_finished_at,
    result_run_id
  ) REFERENCES monitoring.check_runs (
    owner_id,
    check_id,
    finished_at,
    id
  ) DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE monitoring.check_runs
  ADD CONSTRAINT check_runs_rejection_reason_valid CHECK (
    rejection_reason IS NULL OR rejection_reason IN (
      'DUPLICATE_RUN',
      'ATTEMPT_NOT_CURRENT',
      'CHECK_DELETED',
      'DIAGNOSTIC_RUN',
      'CHECK_PAUSED',
      'PROBE_GENERATION_MISMATCH',
      'SCHEDULE_GENERATION_MISMATCH',
      'STALE_FENCING_TOKEN'
    )
  ) NOT VALID;

ALTER TABLE monitoring.check_runs
  VALIDATE CONSTRAINT check_runs_rejection_reason_valid;

-- Destination activation is a deployment capability, not a transient health
-- flag. Producers only create dispatches for rows present in this table.
CREATE TABLE infra.destination_activations (
  destination text PRIMARY KEY,
  activated_at timestamptz NOT NULL,
  activated_by_revision bigint NOT NULL CHECK (activated_by_revision >= 14),
  CONSTRAINT destination_activations_destination_valid CHECK (
    destination IN ('REALTIME', 'NOTIFICATION', 'PREDICTION', 'AUDIT')
  )
);

UPDATE infra.outbox_dispatches
SET state = 'COMPLETED',
    completed_at = statement_timestamp(),
    last_error_code = 'DESTINATION_NOT_ACTIVATED',
    updated_at = statement_timestamp()
WHERE state IN ('PENDING', 'RETRY_WAIT')
  AND NOT EXISTS (
    SELECT 1
    FROM infra.destination_activations AS activation
    WHERE activation.destination = outbox_dispatches.destination
  );

REVOKE ALL ON infra.destination_activations FROM PUBLIC;
GRANT SELECT ON infra.destination_activations TO
  site_monitor_api,
  site_monitor_monitor,
  site_monitor_notifier,
  site_monitor_predictor,
  site_monitor_public,
  site_monitor_housekeeper;

GRANT UPDATE (manual_requested_mode) ON app.checks TO site_monitor_api;
GRANT UPDATE (manual_requested_mode) ON app.checks TO site_monitor_monitor;
GRANT UPDATE (cancellation_requested_at, cancellation_reason) ON monitoring.check_jobs
  TO site_monitor_api;

COMMENT ON TABLE infra.destination_activations IS
  'Migration-owned cutover registry. Consumer outages do not remove activation rows.';
COMMENT ON COLUMN monitoring.check_job_attempts.result_run_finished_at IS
  'Partition key of the one immutable run recorded for this attempt.';

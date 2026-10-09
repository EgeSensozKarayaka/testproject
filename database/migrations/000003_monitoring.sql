-- migrate:transaction true

CREATE TABLE monitoring.check_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  trigger_kind text NOT NULL,
  manual_mode text,
  scheduled_for timestamptz NOT NULL,
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  priority smallint NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'PENDING',
  config_snapshot jsonb NOT NULL,
  resource_version bigint NOT NULL CHECK (resource_version >= 1),
  probe_generation bigint NOT NULL CHECK (probe_generation >= 1),
  schedule_generation bigint NOT NULL CHECK (schedule_generation >= 1),
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  fencing_token bigint,
  started_at timestamptz,
  completed_at timestamptz,
  terminal_reason text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT check_jobs_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_jobs_owner_check_id_unique UNIQUE (owner_id, check_id, id),
  CONSTRAINT check_jobs_trigger_valid CHECK (trigger_kind IN ('SCHEDULED', 'MANUAL')),
  CONSTRAINT check_jobs_manual_mode_valid CHECK (
    (trigger_kind = 'SCHEDULED' AND manual_mode IS NULL)
    OR (trigger_kind = 'MANUAL' AND manual_mode IN ('STATEFUL', 'DIAGNOSTIC'))
  ),
  CONSTRAINT check_jobs_state_valid CHECK (state IN ('PENDING', 'LEASED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'DEAD')),
  CONSTRAINT check_jobs_config_object CHECK (jsonb_typeof(config_snapshot) = 'object' AND octet_length(config_snapshot::text) <= 16384),
  CONSTRAINT check_jobs_attempts_valid CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
  CONSTRAINT check_jobs_lease_consistent CHECK (
    (state IN ('LEASED', 'RUNNING') AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND fencing_token IS NOT NULL)
    OR (state NOT IN ('LEASED', 'RUNNING'))
  ),
  CONSTRAINT check_jobs_terminal_consistent CHECK (
    (state IN ('COMPLETED', 'CANCELLED', 'DEAD') AND completed_at IS NOT NULL)
    OR (state NOT IN ('COMPLETED', 'CANCELLED', 'DEAD') AND completed_at IS NULL)
  ),
  CONSTRAINT check_jobs_timestamps_valid CHECK (updated_at >= created_at AND (completed_at IS NULL OR completed_at >= created_at))
);

CREATE UNIQUE INDEX check_jobs_one_active_per_check_idx ON monitoring.check_jobs (owner_id, check_id)
WHERE state IN ('PENDING', 'LEASED', 'RUNNING');
CREATE INDEX check_jobs_claim_idx ON monitoring.check_jobs (available_at, priority DESC, created_at, id)
WHERE state = 'PENDING';
CREATE INDEX check_jobs_lease_recovery_idx ON monitoring.check_jobs (lease_expires_at, id)
WHERE state IN ('LEASED', 'RUNNING');
CREATE INDEX check_jobs_history_idx ON monitoring.check_jobs (owner_id, check_id, created_at DESC, id);

CREATE TABLE monitoring.check_job_attempts (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_number smallint NOT NULL CHECK (attempt_number >= 1),
  worker_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
  lease_acquired_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz,
  ended_at timestamptz,
  terminal_reason text,
  result_recorded_at timestamptz,
  CONSTRAINT check_job_attempts_job_fk FOREIGN KEY (owner_id, check_id, job_id)
    REFERENCES monitoring.check_jobs (owner_id, check_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_job_attempts_lineage_unique UNIQUE (owner_id, check_id, job_id, id),
  CONSTRAINT check_job_attempts_number_unique UNIQUE (job_id, attempt_number),
  CONSTRAINT check_job_attempts_fencing_unique UNIQUE (job_id, fencing_token),
  CONSTRAINT check_job_attempts_worker_not_blank CHECK (btrim(worker_id) <> ''),
  CONSTRAINT check_job_attempts_terminal_valid CHECK (
    terminal_reason IS NULL OR terminal_reason IN ('RESULT_RECORDED', 'LEASE_LOST', 'INTERNAL_ERROR', 'CANCELLED')
  ),
  CONSTRAINT check_job_attempts_end_consistent CHECK ((ended_at IS NULL) = (terminal_reason IS NULL)),
  CONSTRAINT check_job_attempts_timestamps_valid CHECK (
    started_at >= lease_acquired_at
    AND (last_heartbeat_at IS NULL OR last_heartbeat_at >= lease_acquired_at)
    AND (ended_at IS NULL OR ended_at >= started_at)
  )
);

CREATE INDEX check_job_attempts_job_idx ON monitoring.check_job_attempts (job_id, attempt_number DESC);

CREATE TABLE monitoring.check_runs (
  finished_at timestamptz NOT NULL,
  id uuid NOT NULL DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  trigger_kind text NOT NULL,
  manual_mode text,
  resource_version bigint NOT NULL CHECK (resource_version >= 1),
  probe_generation bigint NOT NULL CHECK (probe_generation >= 1),
  schedule_generation bigint NOT NULL CHECK (schedule_generation >= 1),
  fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
  scheduled_for timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  dns_ms integer,
  connect_ms integer,
  tls_ms integer,
  ttfb_ms integer,
  total_ms integer NOT NULL,
  status_code smallint,
  body_match boolean,
  outcome text NOT NULL,
  failure_category text,
  diagnostic varchar(1024),
  accepted_for_state boolean NOT NULL,
  rejection_reason text,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (owner_id, check_id, finished_at, id),
  CONSTRAINT check_runs_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_runs_job_fk FOREIGN KEY (owner_id, check_id, job_id)
    REFERENCES monitoring.check_jobs (owner_id, check_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_runs_attempt_fk FOREIGN KEY (owner_id, check_id, job_id, attempt_id)
    REFERENCES monitoring.check_job_attempts (owner_id, check_id, job_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_runs_trigger_valid CHECK (trigger_kind IN ('SCHEDULED', 'MANUAL')),
  CONSTRAINT check_runs_manual_mode_valid CHECK (
    (trigger_kind = 'SCHEDULED' AND manual_mode IS NULL)
    OR (trigger_kind = 'MANUAL' AND manual_mode IN ('STATEFUL', 'DIAGNOSTIC'))
  ),
  CONSTRAINT check_runs_timing_nonnegative CHECK (
    dns_ms >= 0 AND connect_ms >= 0 AND tls_ms >= 0 AND ttfb_ms >= 0 AND total_ms >= 0
  ),
  CONSTRAINT check_runs_http_status_valid CHECK (status_code IS NULL OR status_code BETWEEN 100 AND 599),
  CONSTRAINT check_runs_outcome_valid CHECK (outcome IN ('PASS', 'FAIL')),
  CONSTRAINT check_runs_failure_consistent CHECK (
    (outcome = 'PASS' AND failure_category IS NULL)
    OR (outcome = 'FAIL' AND failure_category IS NOT NULL)
  ),
  CONSTRAINT check_runs_acceptance_consistent CHECK (
    (accepted_for_state AND rejection_reason IS NULL)
    OR (NOT accepted_for_state AND rejection_reason IS NOT NULL)
  ),
  CONSTRAINT check_runs_timestamps_valid CHECK (finished_at >= started_at AND started_at >= scheduled_for)
) PARTITION BY RANGE (finished_at);

CREATE INDEX check_runs_history_idx
  ON monitoring.check_runs (owner_id, check_id, finished_at DESC, id)
  INCLUDE (outcome, total_ms, status_code, accepted_for_state);
CREATE INDEX check_runs_rollup_source_idx ON monitoring.check_runs (finished_at, check_id)
WHERE accepted_for_state;

CREATE TABLE monitoring.incidents (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  observation_mode text NOT NULL DEFAULT 'OBSERVED',
  first_failure_run_id uuid NOT NULL,
  first_failure_run_finished_at timestamptz NOT NULL,
  confirmation_run_id uuid NOT NULL,
  confirmation_run_finished_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  confirmed_at timestamptz NOT NULL,
  closed_at timestamptz,
  closure_reason text,
  observed_duration_ms bigint NOT NULL DEFAULT 0 CHECK (observed_duration_ms >= 0),
  last_failure_category text,
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT incidents_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT incidents_first_run_fk FOREIGN KEY (owner_id, check_id, first_failure_run_finished_at, first_failure_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT incidents_confirmation_run_fk FOREIGN KEY (owner_id, check_id, confirmation_run_finished_at, confirmation_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT incidents_lineage_unique UNIQUE (owner_id, check_id, id),
  CONSTRAINT incidents_status_valid CHECK (status IN ('OPEN', 'CLOSED')),
  CONSTRAINT incidents_observation_valid CHECK (observation_mode IN ('OBSERVED', 'UNOBSERVED')),
  CONSTRAINT incidents_closure_reason_valid CHECK (
    closure_reason IS NULL OR closure_reason IN ('RECOVERED', 'CONFIG_CHANGED', 'CHECK_DELETED', 'ADMINISTRATIVE')
  ),
  CONSTRAINT incidents_closure_consistent CHECK (
    (status = 'OPEN' AND closed_at IS NULL AND closure_reason IS NULL)
    OR (status = 'CLOSED' AND closed_at IS NOT NULL AND closure_reason IS NOT NULL)
  ),
  CONSTRAINT incidents_timestamps_valid CHECK (
    confirmed_at >= started_at
    AND (closed_at IS NULL OR closed_at >= started_at)
    AND updated_at >= created_at
  )
);

CREATE UNIQUE INDEX incidents_one_open_per_check_idx ON monitoring.incidents (owner_id, check_id)
WHERE status = 'OPEN';
CREATE INDEX incidents_journal_idx ON monitoring.incidents (owner_id, check_id, started_at DESC, id);
CREATE INDEX incidents_owner_status_idx ON monitoring.incidents (owner_id, status, started_at DESC, id);

CREATE TABLE monitoring.incident_segments (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  start_run_id uuid NOT NULL,
  start_run_finished_at timestamptz NOT NULL,
  end_run_id uuid,
  end_run_finished_at timestamptz,
  close_reason text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT incident_segments_incident_fk FOREIGN KEY (owner_id, check_id, incident_id)
    REFERENCES monitoring.incidents (owner_id, check_id, id) ON DELETE RESTRICT,
  CONSTRAINT incident_segments_start_run_fk FOREIGN KEY (owner_id, check_id, start_run_finished_at, start_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT incident_segments_end_run_fk FOREIGN KEY (owner_id, check_id, end_run_finished_at, end_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT incident_segments_end_run_pair CHECK (num_nonnulls(end_run_id, end_run_finished_at) IN (0, 2)),
  CONSTRAINT incident_segments_close_reason_valid CHECK (
    close_reason IS NULL OR close_reason IN ('RECOVERED', 'STALE', 'PAUSED', 'CONFIG_CHANGED', 'DELETED')
  ),
  CONSTRAINT incident_segments_end_consistent CHECK (
    (ended_at IS NULL AND close_reason IS NULL)
    OR (ended_at IS NOT NULL AND close_reason IS NOT NULL AND ended_at > started_at)
  ),
  CONSTRAINT incident_segments_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX incident_segments_one_open_idx ON monitoring.incident_segments (incident_id)
WHERE ended_at IS NULL;
CREATE INDEX incident_segments_history_idx ON monitoring.incident_segments (owner_id, incident_id, started_at, id);

CREATE TABLE monitoring.check_current_states (
  check_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  health_state text NOT NULL DEFAULT 'UNKNOWN',
  freshness_state text NOT NULL DEFAULT 'STALE',
  consecutive_failure_count integer NOT NULL DEFAULT 0 CHECK (consecutive_failure_count >= 0),
  candidate_started_at timestamptz,
  candidate_run_id uuid,
  candidate_run_finished_at timestamptz,
  open_incident_id uuid,
  last_accepted_run_id uuid,
  last_accepted_run_finished_at timestamptz,
  last_accepted_fencing_token bigint NOT NULL DEFAULT 0 CHECK (last_accepted_fencing_token >= 0),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_response_time_ms integer,
  last_status_code smallint,
  last_failure_category text,
  fresh_until timestamptz,
  stale_reconciled_at timestamptz,
  state_version bigint NOT NULL DEFAULT 1 CHECK (state_version >= 1),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT check_current_states_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_current_states_owner_check_unique UNIQUE (owner_id, check_id),
  CONSTRAINT check_current_states_candidate_run_fk FOREIGN KEY (owner_id, check_id, candidate_run_finished_at, candidate_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT check_current_states_last_run_fk FOREIGN KEY (owner_id, check_id, last_accepted_run_finished_at, last_accepted_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT check_current_states_incident_fk FOREIGN KEY (owner_id, check_id, open_incident_id)
    REFERENCES monitoring.incidents (owner_id, check_id, id) ON DELETE RESTRICT,
  CONSTRAINT check_current_states_health_valid CHECK (health_state IN ('UNKNOWN', 'UP', 'SUSPECT', 'DOWN')),
  CONSTRAINT check_current_states_freshness_valid CHECK (freshness_state IN ('FRESH', 'STALE')),
  CONSTRAINT check_current_states_candidate_pair CHECK (num_nonnulls(candidate_run_id, candidate_run_finished_at) IN (0, 2)),
  CONSTRAINT check_current_states_last_run_pair CHECK (num_nonnulls(last_accepted_run_id, last_accepted_run_finished_at) IN (0, 2)),
  CONSTRAINT check_current_states_response_time_valid CHECK (last_response_time_ms IS NULL OR last_response_time_ms >= 0),
  CONSTRAINT check_current_states_status_code_valid CHECK (last_status_code IS NULL OR last_status_code BETWEEN 100 AND 599)
);

CREATE INDEX check_current_states_dashboard_idx
  ON monitoring.check_current_states (owner_id, health_state, updated_at DESC, check_id);
CREATE INDEX check_current_states_freshness_idx ON monitoring.check_current_states (fresh_until, check_id)
WHERE fresh_until IS NOT NULL;

CREATE TABLE monitoring.open_health_intervals (
  check_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT uuidv7(),
  classification text NOT NULL,
  started_at timestamptz NOT NULL,
  probe_generation bigint NOT NULL CHECK (probe_generation >= 1),
  source_kind text NOT NULL,
  source_run_id uuid,
  source_run_finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT open_health_intervals_id_unique UNIQUE (id),
  CONSTRAINT open_health_intervals_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT open_health_intervals_source_run_fk FOREIGN KEY (owner_id, check_id, source_run_finished_at, source_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT open_health_intervals_classification_valid CHECK (classification IN ('UP', 'DOWN', 'UNKNOWN', 'PROVISIONAL')),
  CONSTRAINT open_health_intervals_source_valid CHECK (source_kind IN ('RUN', 'FRESHNESS', 'PAUSE', 'RESUME', 'CONFIG', 'STARTUP')),
  CONSTRAINT open_health_intervals_source_pair CHECK (num_nonnulls(source_run_id, source_run_finished_at) IN (0, 2))
);

CREATE TABLE monitoring.health_intervals (
  started_at timestamptz NOT NULL,
  id uuid NOT NULL,
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  ended_at timestamptz NOT NULL,
  classification text NOT NULL,
  probe_generation bigint NOT NULL CHECK (probe_generation >= 1),
  source_kind text NOT NULL,
  source_run_id uuid,
  source_run_finished_at timestamptz,
  finalized_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (owner_id, check_id, started_at, id),
  CONSTRAINT health_intervals_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT health_intervals_source_run_fk FOREIGN KEY (owner_id, check_id, source_run_finished_at, source_run_id)
    REFERENCES monitoring.check_runs (owner_id, check_id, finished_at, id) ON DELETE RESTRICT,
  CONSTRAINT health_intervals_classification_valid CHECK (classification IN ('UP', 'DOWN', 'UNKNOWN')),
  CONSTRAINT health_intervals_source_valid CHECK (source_kind IN ('RUN', 'FRESHNESS', 'PAUSE', 'RESUME', 'CONFIG', 'STARTUP')),
  CONSTRAINT health_intervals_source_pair CHECK (num_nonnulls(source_run_id, source_run_finished_at) IN (0, 2)),
  CONSTRAINT health_intervals_range_valid CHECK (ended_at > started_at)
) PARTITION BY RANGE (started_at);

CREATE INDEX health_intervals_history_idx
  ON monitoring.health_intervals (owner_id, check_id, started_at, ended_at);

CREATE TABLE monitoring.rollups_minute (
  bucket_start timestamptz NOT NULL,
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  probe_generation bigint NOT NULL CHECK (probe_generation >= 1),
  accepted_run_count integer NOT NULL DEFAULT 0 CHECK (accepted_run_count >= 0),
  pass_count integer NOT NULL DEFAULT 0 CHECK (pass_count >= 0),
  fail_count integer NOT NULL DEFAULT 0 CHECK (fail_count >= 0),
  response_sample_count integer NOT NULL DEFAULT 0 CHECK (response_sample_count >= 0),
  response_sum_ms bigint NOT NULL DEFAULT 0 CHECK (response_sum_ms >= 0),
  response_min_ms integer,
  response_max_ms integer,
  up_ms bigint NOT NULL DEFAULT 0 CHECK (up_ms >= 0),
  down_ms bigint NOT NULL DEFAULT 0 CHECK (down_ms >= 0),
  unknown_ms bigint NOT NULL DEFAULT 0 CHECK (unknown_ms >= 0),
  provisional_ms bigint NOT NULL DEFAULT 0 CHECK (provisional_ms >= 0),
  computed_through timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (owner_id, check_id, bucket_start, probe_generation),
  CONSTRAINT rollups_minute_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT rollups_minute_counts_valid CHECK (accepted_run_count = pass_count + fail_count),
  CONSTRAINT rollups_minute_response_valid CHECK (
    (response_sample_count = 0 AND response_min_ms IS NULL AND response_max_ms IS NULL)
    OR (response_sample_count > 0 AND response_min_ms >= 0 AND response_max_ms >= response_min_ms)
  )
) PARTITION BY RANGE (bucket_start);

CREATE INDEX rollups_minute_history_idx ON monitoring.rollups_minute (owner_id, check_id, bucket_start);

CREATE TABLE monitoring.rollups_hour (
  LIKE monitoring.rollups_minute INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING STORAGE
) PARTITION BY RANGE (bucket_start);

ALTER TABLE monitoring.rollups_hour
  ADD CONSTRAINT rollups_hour_pk PRIMARY KEY (owner_id, check_id, bucket_start, probe_generation),
  ADD CONSTRAINT rollups_hour_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT;

CREATE INDEX rollups_hour_history_idx ON monitoring.rollups_hour (owner_id, check_id, bucket_start);

CREATE TABLE monitoring.rollup_checkpoints (
  processor_name text PRIMARY KEY,
  watermark_at timestamptz NOT NULL,
  last_partition text,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_error_code text,
  CONSTRAINT rollup_checkpoints_name_not_blank CHECK (btrim(processor_name) <> '')
);

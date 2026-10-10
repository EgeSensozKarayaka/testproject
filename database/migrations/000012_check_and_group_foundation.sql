-- migrate:transaction true

ALTER TABLE app.check_groups
  ADD COLUMN description varchar(1000);

ALTER TABLE app.checks
  ADD CONSTRAINT checks_expected_body_utf8_bytes_valid
  CHECK (
    expected_body_substring IS NULL
    OR octet_length(expected_body_substring) BETWEEN 1 AND 2048
  ) NOT VALID;

ALTER TABLE app.checks
  VALIDATE CONSTRAINT checks_expected_body_utf8_bytes_valid;

REVOKE DELETE ON app.check_groups, app.checks FROM site_monitor_api;
REVOKE UPDATE ON app.check_groups, app.checks FROM site_monitor_api;

GRANT UPDATE (name, description, resource_version, updated_at, deleted_at)
  ON app.check_groups TO site_monitor_api;
GRANT UPDATE (
  group_id,
  name,
  url,
  interval_seconds,
  timeout_ms,
  expected_status_code,
  expected_body_substring,
  lifecycle_state,
  execution_state,
  resource_version,
  probe_generation,
  schedule_generation,
  cadence_anchor_at,
  next_run_at,
  manual_requested_at,
  updated_at,
  deleted_at
) ON app.checks TO site_monitor_api;

GRANT INSERT ON monitoring.check_current_states, monitoring.check_jobs TO site_monitor_api;
GRANT UPDATE (
  health_state,
  freshness_state,
  consecutive_failure_count,
  candidate_started_at,
  candidate_run_id,
  candidate_run_finished_at,
  open_incident_id,
  fresh_until,
  stale_reconciled_at,
  state_version,
  updated_at
) ON monitoring.check_current_states TO site_monitor_api;
GRANT UPDATE (state, completed_at, terminal_reason, updated_at)
  ON monitoring.check_jobs TO site_monitor_api;

GRANT USAGE ON SCHEMA audit TO site_monitor_api;
GRANT INSERT ON infra.outbox_events, infra.outbox_dispatches, audit.events TO site_monitor_api;

CREATE POLICY api_owner_insert ON infra.outbox_events
  FOR INSERT
  TO site_monitor_api
  WITH CHECK (owner_id = security_api.current_owner_id());

CREATE POLICY api_owner_insert ON audit.events
  FOR INSERT
  TO site_monitor_api
  WITH CHECK (owner_id = security_api.current_owner_id());

COMMENT ON COLUMN app.check_groups.description IS
  'Optional owner-visible description. Normalized and limited to 1000 Unicode code points by the API.';
COMMENT ON CONSTRAINT checks_expected_body_utf8_bytes_valid ON app.checks IS
  'Expected literal is null or 1..2048 UTF-8 bytes; response bodies are never stored here.';

-- migrate:transaction true

CREATE FUNCTION security_api.current_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = pg_catalog
AS $function$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$function$;

REVOKE ALL ON FUNCTION security_api.current_owner_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.current_owner_id() TO site_monitor_api;

DO $enable_rls$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'auth.users',
    'auth.password_credentials',
    'auth.sessions',
    'auth.one_time_tokens',
    'app.check_groups',
    'app.checks',
    'app.maintenance_windows',
    'monitoring.check_jobs',
    'monitoring.check_job_attempts',
    'monitoring.check_runs',
    'monitoring.incidents',
    'monitoring.incident_segments',
    'monitoring.check_current_states',
    'monitoring.open_health_intervals',
    'monitoring.health_intervals',
    'monitoring.rollups_minute',
    'monitoring.rollups_hour',
    'infra.outbox_events',
    'notification.recipients',
    'notification.recipient_verification_tokens',
    'notification.policies',
    'notification.policy_recipients',
    'notification.intents',
    'notification.deliveries',
    'public_status.pages',
    'public_status.components',
    'public_status.snapshots',
    'prediction.analysis_jobs',
    'prediction.scores',
    'audit.events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format(
      'CREATE POLICY schema_owner_all ON %s TO site_monitor_schema_owner USING (true) WITH CHECK (true)',
      relation_name
    );
  END LOOP;
END
$enable_rls$;

CREATE POLICY api_own_user ON auth.users
  TO site_monitor_api
  USING (id = security_api.current_owner_id())
  WITH CHECK (id = security_api.current_owner_id());

DO $api_owner_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'auth.password_credentials',
    'auth.sessions',
    'auth.one_time_tokens',
    'app.check_groups',
    'app.checks',
    'app.maintenance_windows',
    'monitoring.check_jobs',
    'monitoring.check_job_attempts',
    'monitoring.check_runs',
    'monitoring.incidents',
    'monitoring.incident_segments',
    'monitoring.check_current_states',
    'monitoring.open_health_intervals',
    'monitoring.health_intervals',
    'monitoring.rollups_minute',
    'monitoring.rollups_hour',
    'notification.recipients',
    'notification.recipient_verification_tokens',
    'notification.policies',
    'notification.policy_recipients',
    'notification.intents',
    'notification.deliveries',
    'public_status.pages',
    'public_status.components',
    'public_status.snapshots',
    'prediction.analysis_jobs',
    'prediction.scores'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY api_owner_access ON %s TO site_monitor_api USING (owner_id = security_api.current_owner_id()) WITH CHECK (owner_id = security_api.current_owner_id())',
      relation_name
    );
  END LOOP;
END
$api_owner_policies$;

DO $monitor_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'app.check_groups',
    'app.checks',
    'app.maintenance_windows',
    'monitoring.check_jobs',
    'monitoring.check_job_attempts',
    'monitoring.check_runs',
    'monitoring.incidents',
    'monitoring.incident_segments',
    'monitoring.check_current_states',
    'monitoring.open_health_intervals',
    'monitoring.health_intervals',
    'monitoring.rollups_minute',
    'monitoring.rollups_hour',
    'infra.outbox_events',
    'public_status.snapshots',
    'prediction.analysis_jobs',
    'audit.events'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY monitor_all_tenants ON %s TO site_monitor_monitor USING (true) WITH CHECK (true)',
      relation_name
    );
  END LOOP;
END
$monitor_policies$;

DO $notifier_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'app.check_groups',
    'app.checks',
    'app.maintenance_windows',
    'monitoring.incidents',
    'monitoring.incident_segments',
    'monitoring.check_current_states',
    'infra.outbox_events',
    'notification.recipients',
    'notification.recipient_verification_tokens',
    'notification.policies',
    'notification.policy_recipients',
    'notification.intents',
    'notification.deliveries',
    'audit.events'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY notifier_all_tenants ON %s TO site_monitor_notifier USING (true) WITH CHECK (true)',
      relation_name
    );
  END LOOP;
END
$notifier_policies$;

DO $predictor_policies$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'prediction.analysis_jobs',
    'prediction.scores',
    'audit.events'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY predictor_all_tenants ON %s TO site_monitor_predictor USING (true) WITH CHECK (true)',
      relation_name
    );
  END LOOP;
END
$predictor_policies$;

GRANT USAGE ON SCHEMA infra TO site_monitor_api, site_monitor_monitor, site_monitor_notifier, site_monitor_predictor, site_monitor_public, site_monitor_housekeeper;
GRANT SELECT ON infra.schema_compatibility TO site_monitor_api, site_monitor_monitor, site_monitor_notifier, site_monitor_predictor, site_monitor_public, site_monitor_housekeeper;

GRANT USAGE ON SCHEMA auth, app, monitoring, notification, public_status, prediction, security_api TO site_monitor_api;
GRANT SELECT ON auth.users TO site_monitor_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.check_groups, app.checks, app.maintenance_windows TO site_monitor_api;
GRANT SELECT ON
  monitoring.check_jobs,
  monitoring.check_job_attempts,
  monitoring.check_runs,
  monitoring.incidents,
  monitoring.incident_segments,
  monitoring.check_current_states,
  monitoring.open_health_intervals,
  monitoring.health_intervals,
  monitoring.rollups_minute,
  monitoring.rollups_hour
TO site_monitor_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  notification.recipients,
  notification.recipient_verification_tokens,
  notification.policies,
  notification.policy_recipients
TO site_monitor_api;
GRANT SELECT ON notification.intents, notification.deliveries TO site_monitor_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON public_status.pages, public_status.components, public_status.snapshots TO site_monitor_api;
GRANT SELECT ON prediction.analysis_jobs, prediction.scores, prediction.model_versions TO site_monitor_api;

GRANT USAGE ON SCHEMA app, monitoring, infra, public_status, prediction, audit TO site_monitor_monitor;
GRANT SELECT ON app.check_groups, app.checks, app.maintenance_windows TO site_monitor_monitor;
GRANT UPDATE (next_run_at, manual_requested_at, next_fencing_token, updated_at) ON app.checks TO site_monitor_monitor;
GRANT SELECT, INSERT, UPDATE ON
  monitoring.check_jobs,
  monitoring.check_job_attempts,
  monitoring.check_current_states,
  monitoring.open_health_intervals,
  monitoring.incidents,
  monitoring.incident_segments,
  monitoring.rollups_minute,
  monitoring.rollups_hour,
  monitoring.rollup_checkpoints
TO site_monitor_monitor;
GRANT SELECT, INSERT ON monitoring.check_runs, monitoring.health_intervals TO site_monitor_monitor;
GRANT SELECT, INSERT ON infra.outbox_events, infra.outbox_dispatches TO site_monitor_monitor;
GRANT UPDATE ON infra.outbox_dispatches TO site_monitor_monitor;
GRANT SELECT, INSERT, UPDATE, DELETE ON public_status.snapshots TO site_monitor_monitor;
GRANT SELECT, INSERT, UPDATE ON prediction.analysis_jobs TO site_monitor_monitor;
GRANT INSERT ON audit.events TO site_monitor_monitor;

GRANT USAGE ON SCHEMA app, monitoring, infra, notification, audit TO site_monitor_notifier;
GRANT SELECT ON app.check_groups, app.checks, app.maintenance_windows TO site_monitor_notifier;
GRANT SELECT ON monitoring.incidents, monitoring.incident_segments, monitoring.check_current_states TO site_monitor_notifier;
GRANT SELECT ON notification.recipients, notification.policies, notification.policy_recipients TO site_monitor_notifier;
GRANT SELECT, INSERT, UPDATE ON notification.intents, notification.deliveries TO site_monitor_notifier;
GRANT SELECT ON infra.outbox_events, infra.outbox_dispatches TO site_monitor_notifier;
GRANT UPDATE ON infra.outbox_dispatches TO site_monitor_notifier;
GRANT INSERT ON audit.events TO site_monitor_notifier;

CREATE VIEW prediction.feature_rollups_hour
WITH (security_barrier = true)
AS
SELECT
  owner_id,
  check_id,
  bucket_start,
  probe_generation,
  accepted_run_count,
  pass_count,
  fail_count,
  response_sample_count,
  response_sum_ms,
  response_min_ms,
  response_max_ms,
  up_ms,
  down_ms,
  unknown_ms,
  provisional_ms,
  computed_through,
  revision
FROM monitoring.rollups_hour;

REVOKE ALL ON prediction.feature_rollups_hour FROM PUBLIC;
GRANT USAGE ON SCHEMA prediction, audit TO site_monitor_predictor;
GRANT SELECT, UPDATE ON prediction.analysis_jobs TO site_monitor_predictor;
GRANT SELECT, INSERT ON prediction.scores TO site_monitor_predictor;
GRANT SELECT ON prediction.model_versions, prediction.feature_rollups_hour TO site_monitor_predictor;
GRANT INSERT ON audit.events TO site_monitor_predictor;

CREATE FUNCTION security_api.resolve_session(p_token_digest bytea)
RETURNS TABLE (
  owner_id uuid,
  session_id uuid,
  expires_at timestamptz,
  user_status text,
  issued_password_version integer,
  current_password_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    session_row.owner_id,
    session_row.id,
    session_row.expires_at,
    user_row.status,
    session_row.issued_password_version,
    credential_row.password_version
  FROM auth.sessions AS session_row
  JOIN auth.users AS user_row ON user_row.id = session_row.owner_id
  JOIN auth.password_credentials AS credential_row ON credential_row.owner_id = user_row.id
  WHERE session_row.token_digest = p_token_digest
    AND session_row.revoked_at IS NULL
    AND session_row.expires_at > statement_timestamp()
    AND user_row.status = 'ACTIVE'
    AND session_row.issued_password_version = credential_row.password_version
  LIMIT 1
$function$;

CREATE FUNCTION security_api.lookup_login_credential(p_email_normalized text)
RETURNS TABLE (
  owner_id uuid,
  password_hash text,
  password_version integer,
  user_status text,
  email_verified_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    user_row.id,
    credential_row.password_hash,
    credential_row.password_version,
    user_row.status,
    user_row.email_verified_at
  FROM auth.users AS user_row
  JOIN auth.password_credentials AS credential_row ON credential_row.owner_id = user_row.id
  WHERE user_row.email_normalized = p_email_normalized
  LIMIT 1
$function$;

CREATE FUNCTION security_api.consume_one_time_token(p_purpose text, p_token_digest bytea)
RETURNS TABLE (owner_id uuid, token_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN QUERY
  UPDATE auth.one_time_tokens AS token_row
  SET consumed_at = statement_timestamp()
  WHERE token_row.purpose = p_purpose
    AND token_row.token_digest = p_token_digest
    AND token_row.consumed_at IS NULL
    AND token_row.expires_at > statement_timestamp()
  RETURNING token_row.owner_id, token_row.id;
END
$function$;

CREATE FUNCTION security_api.read_public_snapshot(p_slug_digest bytea)
RETURNS TABLE (
  payload jsonb,
  payload_schema_version smallint,
  generated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT snapshot_row.payload, snapshot_row.payload_schema_version, snapshot_row.generated_at
  FROM public_status.snapshots AS snapshot_row
  JOIN public_status.pages AS page_row
    ON page_row.owner_id = snapshot_row.owner_id AND page_row.id = snapshot_row.page_id
  WHERE snapshot_row.slug_digest = p_slug_digest
    AND page_row.state = 'PUBLISHED'
    AND page_row.deleted_at IS NULL
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION security_api.resolve_session(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.lookup_login_credential(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.consume_one_time_token(text, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.read_public_snapshot(bytea) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION security_api.resolve_session(bytea) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.lookup_login_credential(text) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.consume_one_time_token(text, bytea) TO site_monitor_api;
GRANT USAGE ON SCHEMA security_api TO site_monitor_public;
GRANT EXECUTE ON FUNCTION security_api.read_public_snapshot(bytea) TO site_monitor_public;

REVOKE ALL ON ALL TABLES IN SCHEMA auth, app, monitoring, notification, public_status, prediction, audit FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA security_api FROM PUBLIC;

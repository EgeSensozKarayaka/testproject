-- migrate:transaction true

-- Runtime roles are normally provisioned by the platform. Local development
-- uses the bootstrap superuser, so create the new NOLOGIN group role when the
-- session is allowed to do so. Existing managed roles are validated instead
-- of being altered silently.
RESET ROLE;

DO $realtime_role$
DECLARE
  existing_role record;
  executor_role record;
BEGIN
  SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit,
         rolreplication, rolbypassrls
  INTO existing_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'site_monitor_realtime';

  IF NOT FOUND THEN
    SELECT rolsuper, rolcreaterole
    INTO executor_role
    FROM pg_catalog.pg_roles
    WHERE rolname = current_user;

    IF NOT (executor_role.rolsuper OR executor_role.rolcreaterole) THEN
      RAISE EXCEPTION
        'site_monitor_realtime must be provisioned as a NOLOGIN NOBYPASSRLS role before migration 27'
        USING ERRCODE = '42501';
    END IF;

    CREATE ROLE site_monitor_realtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
  ELSIF existing_role.rolcanlogin
     OR existing_role.rolsuper
     OR existing_role.rolcreatedb
     OR existing_role.rolcreaterole
     OR existing_role.rolinherit
     OR existing_role.rolreplication
     OR existing_role.rolbypassrls THEN
    RAISE EXCEPTION 'site_monitor_realtime has unsafe role attributes'
      USING ERRCODE = '42501';
  END IF;
END
$realtime_role$;

SET LOCAL ROLE site_monitor_schema_owner;

CREATE FUNCTION security_api.claim_realtime_dispatch(
  p_worker_id text,
  p_lease_seconds integer
)
RETURNS TABLE (
  event_id uuid,
  event_type text,
  schema_version smallint,
  owner_id uuid,
  aggregate_type text,
  aggregate_id uuid,
  aggregate_version bigint,
  occurred_at timestamptz,
  fencing_token bigint,
  attempt_count integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_worker_id IS NULL
     OR btrim(p_worker_id) = ''
     OR length(p_worker_id) > 200
     OR p_lease_seconds NOT BETWEEN 5 AND 900 THEN
    RAISE EXCEPTION 'invalid realtime dispatch claim parameters' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT dispatch.event_id
    FROM infra.outbox_dispatches AS dispatch
    WHERE dispatch.destination = 'REALTIME'
      AND (
        (dispatch.state IN ('PENDING', 'RETRY_WAIT')
          AND dispatch.available_at <= statement_timestamp())
        OR (dispatch.state = 'PROCESSING'
          AND dispatch.lease_expires_at <= statement_timestamp())
      )
    ORDER BY dispatch.available_at, dispatch.event_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  ), claimed AS (
    UPDATE infra.outbox_dispatches AS dispatch
    SET state = 'PROCESSING',
        lease_owner = p_worker_id,
        lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
        fencing_token = dispatch.fencing_token + 1,
        attempt_count = dispatch.attempt_count + 1,
        last_error_code = NULL,
        updated_at = statement_timestamp()
    FROM candidate
    WHERE dispatch.event_id = candidate.event_id
      AND dispatch.destination = 'REALTIME'
    RETURNING dispatch.event_id, dispatch.fencing_token, dispatch.attempt_count
  )
  SELECT event.id, event.event_type, event.schema_version, event.owner_id,
         event.aggregate_type, event.aggregate_id, event.aggregate_version,
         event.occurred_at, claimed.fencing_token, claimed.attempt_count
  FROM claimed
  JOIN infra.outbox_events AS event ON event.id = claimed.event_id;
END
$function$;

CREATE FUNCTION security_api.complete_realtime_dispatch(
  p_event_id uuid,
  p_worker_id text,
  p_fencing_token bigint,
  p_result text,
  p_result_code text,
  p_retry_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_event record;
  v_wakeup jsonb;
BEGIN
  IF p_event_id IS NULL
     OR p_worker_id IS NULL
     OR btrim(p_worker_id) = ''
     OR length(p_worker_id) > 200
     OR p_fencing_token < 1
     OR p_result NOT IN ('COMPLETED', 'RETRY', 'DEAD')
     OR p_result_code !~ '^[A-Z][A-Z0-9_]{0,79}$'
     OR p_retry_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid realtime dispatch completion parameters' USING ERRCODE = '22023';
  END IF;

  SELECT event.id, event.owner_id, event.event_type, event.schema_version,
         event.aggregate_type, event.aggregate_id, event.aggregate_version,
         event.occurred_at
  INTO v_event
  FROM infra.outbox_dispatches AS dispatch
  JOIN infra.outbox_events AS event ON event.id = dispatch.event_id
  WHERE dispatch.event_id = p_event_id
    AND dispatch.destination = 'REALTIME'
    AND dispatch.state = 'PROCESSING'
    AND dispatch.lease_owner = p_worker_id
    AND dispatch.fencing_token = p_fencing_token
  FOR UPDATE OF dispatch;

  IF NOT FOUND THEN RETURN false; END IF;

  IF p_result = 'COMPLETED' THEN
    IF v_event.schema_version <> 1
       OR v_event.owner_id IS NULL
       OR v_event.event_type !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
       OR btrim(v_event.aggregate_type) = '' THEN
      RAISE EXCEPTION 'unsafe realtime wakeup event' USING ERRCODE = '22023';
    END IF;

    v_wakeup := jsonb_build_object(
      'v', 1,
      'event_id', v_event.id::text,
      'owner_id', v_event.owner_id::text,
      'event_type', v_event.event_type,
      'aggregate_type', v_event.aggregate_type,
      'aggregate_id', v_event.aggregate_id::text,
      'aggregate_version', CASE
        WHEN v_event.aggregate_version IS NULL THEN 'null'::jsonb
        ELSE to_jsonb(v_event.aggregate_version::text)
      END,
      'occurred_at', to_jsonb(v_event.occurred_at)
    );

    IF octet_length(v_wakeup::text) > 1024 THEN
      RAISE EXCEPTION 'realtime wakeup exceeds byte limit' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE infra.outbox_dispatches AS dispatch
  SET state = CASE p_result
        WHEN 'COMPLETED' THEN 'COMPLETED'
        WHEN 'DEAD' THEN 'DEAD'
        ELSE 'RETRY_WAIT'
      END,
      available_at = CASE WHEN p_result = 'RETRY'
        THEN statement_timestamp() + make_interval(secs => p_retry_seconds)
        ELSE dispatch.available_at END,
      completed_at = CASE WHEN p_result IN ('COMPLETED', 'DEAD')
        THEN statement_timestamp() ELSE NULL END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = p_result_code,
      updated_at = statement_timestamp()
  WHERE dispatch.event_id = p_event_id
    AND dispatch.destination = 'REALTIME'
    AND dispatch.state = 'PROCESSING'
    AND dispatch.lease_owner = p_worker_id
    AND dispatch.fencing_token = p_fencing_token;

  IF NOT FOUND THEN RETURN false; END IF;
  IF p_result = 'COMPLETED' THEN
    PERFORM pg_notify('site_monitor_realtime_v1', v_wakeup::text);
  END IF;
  RETURN true;
END
$function$;

CREATE FUNCTION security_api.realtime_storage_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT compatibility.current_revision >= 27
     AND to_regprocedure('security_api.claim_realtime_dispatch(text,integer)') IS NOT NULL
     AND to_regprocedure('security_api.complete_realtime_dispatch(uuid,text,bigint,text,text,integer)') IS NOT NULL
  FROM infra.schema_compatibility AS compatibility
  WHERE compatibility.singleton_id = true
$function$;

REVOKE ALL ON FUNCTION security_api.claim_realtime_dispatch(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.complete_realtime_dispatch(uuid, text, bigint, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.realtime_storage_ready() FROM PUBLIC;

GRANT USAGE ON SCHEMA infra, security_api TO site_monitor_realtime;
GRANT SELECT ON infra.schema_compatibility TO site_monitor_realtime;
GRANT EXECUTE ON FUNCTION security_api.claim_realtime_dispatch(text, integer)
  TO site_monitor_realtime;
GRANT EXECUTE ON FUNCTION security_api.complete_realtime_dispatch(uuid, text, bigint, text, text, integer)
  TO site_monitor_realtime;
GRANT EXECUTE ON FUNCTION security_api.realtime_storage_ready()
  TO site_monitor_realtime;

REVOKE ALL ON TABLE infra.outbox_events, infra.outbox_dispatches,
  infra.destination_activations FROM site_monitor_realtime;

COMMENT ON FUNCTION security_api.claim_realtime_dispatch(text, integer) IS
  'Claims one REALTIME outbox dispatch with lease recovery and monotonic fencing.';
COMMENT ON FUNCTION security_api.complete_realtime_dispatch(uuid, text, bigint, text, text, integer) IS
  'Fencing-protected REALTIME completion; successful completion and bounded wakeup NOTIFY share one transaction.';
COMMENT ON FUNCTION security_api.realtime_storage_ready() IS
  'Reports whether the realtime relay database boundary is at a compatible revision.';

-- migrate:transaction true

-- Notification runtime database boundary. The NOTIFICATION destination remains
-- inactive in this revision; activation and open-incident reconciliation are a
-- separate cutover migration after the worker has passed preflight.

CREATE FUNCTION security_api.claim_notification_dispatch(
  p_worker_id text,
  p_lease_seconds integer
)
RETURNS TABLE (
  event_id uuid,
  event_type text,
  schema_version smallint,
  owner_id uuid,
  aggregate_id uuid,
  fencing_token bigint,
  attempt_count integer
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF btrim(p_worker_id) = '' OR p_lease_seconds NOT BETWEEN 5 AND 900 THEN
    RAISE EXCEPTION 'invalid notification dispatch claim parameters' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT dispatch.event_id
    FROM infra.outbox_dispatches AS dispatch
    WHERE dispatch.destination = 'NOTIFICATION'
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
        updated_at = statement_timestamp()
    FROM candidate
    WHERE dispatch.event_id = candidate.event_id
      AND dispatch.destination = 'NOTIFICATION'
    RETURNING dispatch.event_id, dispatch.fencing_token, dispatch.attempt_count
  )
  SELECT event.id, event.event_type, event.schema_version, event.owner_id,
         event.aggregate_id, claimed.fencing_token, claimed.attempt_count
  FROM claimed
  JOIN infra.outbox_events AS event ON event.id = claimed.event_id;
END
$function$;

CREATE FUNCTION security_api.complete_notification_dispatch(
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
  v_event_kind text;
  v_check_id uuid;
BEGIN
  IF p_result NOT IN ('COMPLETED', 'RETRY', 'DEAD')
     OR btrim(p_result_code) = '' OR length(p_result_code) > 80
     OR p_retry_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid notification dispatch completion' USING ERRCODE = '22023';
  END IF;

  SELECT event.owner_id, event.event_type, event.schema_version,
         event.aggregate_id, event.payload
  INTO v_event
  FROM infra.outbox_dispatches AS dispatch
  JOIN infra.outbox_events AS event ON event.id = dispatch.event_id
  WHERE dispatch.event_id = p_event_id
    AND dispatch.destination = 'NOTIFICATION'
    AND dispatch.state = 'PROCESSING'
    AND dispatch.lease_owner = p_worker_id
    AND dispatch.fencing_token = p_fencing_token
  FOR UPDATE OF dispatch;

  IF NOT FOUND THEN RETURN false; END IF;

  IF p_result = 'COMPLETED' THEN
    IF v_event.schema_version <> 1 THEN
      RAISE EXCEPTION 'unsupported notification event schema' USING ERRCODE = '22023';
    END IF;

    IF v_event.event_type IN ('incident.opened', 'incident.closed') THEN
      SELECT incident.check_id,
             CASE
               WHEN v_event.event_type = 'incident.opened' THEN 'INCIDENT_OPENED'
               WHEN incident.closure_reason = 'RECOVERED' THEN 'INCIDENT_RECOVERED'
               ELSE 'INCIDENT_CLOSED'
             END
      INTO v_check_id, v_event_kind
      FROM monitoring.incidents AS incident
      WHERE incident.owner_id = v_event.owner_id
        AND incident.id = v_event.aggregate_id;

      IF v_check_id IS NULL THEN
        RAISE EXCEPTION 'notification incident not found' USING ERRCODE = '23503';
      END IF;

      INSERT INTO notification.intents (
        owner_id, check_id, incident_id, source_event_id, event_kind
      ) VALUES (
        v_event.owner_id, v_check_id, v_event.aggregate_id, p_event_id, v_event_kind
      ) ON CONFLICT DO NOTHING;
    ELSIF v_event.event_type IN (
      'maintenance.created', 'maintenance.updated', 'maintenance.cancelled',
      'check.group_changed', 'check.deleted', 'group.deleted',
      'notification.policy_updated', 'notification.recipient_disabled'
    ) THEN
      -- Wake deferred decisions early. The evaluator still resolves all facts
      -- from current tables, never from this potentially stale event payload.
      v_check_id := CASE
        WHEN v_event.payload ? 'check_id'
          THEN (v_event.payload->>'check_id')::uuid
        WHEN v_event.payload->>'target_type' = 'CHECK'
          THEN (v_event.payload->>'target_id')::uuid
        ELSE NULL
      END;

      UPDATE notification.intents AS intent
      SET state = 'PENDING_EVALUATION', maintenance_until = NULL
      WHERE intent.owner_id = v_event.owner_id
        AND intent.state = 'DEFERRED_MAINTENANCE'
        AND (
          (v_check_id IS NOT NULL AND intent.check_id = v_check_id)
          OR (v_event.payload->>'target_type' = 'GROUP' AND EXISTS (
            SELECT 1 FROM app.checks AS check_row
            WHERE check_row.owner_id = intent.owner_id
              AND check_row.id = intent.check_id
              AND check_row.group_id = (v_event.payload->>'target_id')::uuid
          ))
          OR (v_event.event_type = 'group.deleted')
        );

      UPDATE notification.deliveries AS delivery
      SET state = 'PENDING', maintenance_until = NULL,
          available_at = statement_timestamp(), updated_at = statement_timestamp()
      WHERE delivery.owner_id = v_event.owner_id
        AND delivery.state = 'DEFERRED_MAINTENANCE'
        AND EXISTS (
          SELECT 1 FROM notification.intents AS intent
          WHERE intent.id = delivery.intent_id
            AND (v_check_id IS NULL OR intent.check_id = v_check_id)
        );
    ELSE
      RAISE EXCEPTION 'unsupported notification event type' USING ERRCODE = '22023';
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
      lease_owner = NULL, lease_expires_at = NULL,
      last_error_code = p_result_code, updated_at = statement_timestamp()
  WHERE dispatch.event_id = p_event_id
    AND dispatch.destination = 'NOTIFICATION'
    AND dispatch.state = 'PROCESSING'
    AND dispatch.lease_owner = p_worker_id
    AND dispatch.fencing_token = p_fencing_token;
  RETURN FOUND;
END
$function$;

CREATE FUNCTION security_api.evaluate_notification_intent()
RETURNS TABLE (processed boolean, intent_id uuid, resulting_state text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_intent notification.intents%ROWTYPE;
  v_incident record;
  v_check record;
  v_policy record;
  v_maintenance_until timestamptz;
  v_delivery_count integer;
  v_template_key text;
  v_template_payload jsonb;
BEGIN
  SELECT intent.* INTO v_intent
  FROM notification.intents AS intent
  WHERE intent.state = 'PENDING_EVALUATION'
     OR (intent.state = 'DEFERRED_MAINTENANCE'
       AND intent.maintenance_until <= statement_timestamp())
  ORDER BY COALESCE(intent.maintenance_until, intent.created_at), intent.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  SELECT incident.status, incident.started_at, incident.confirmed_at,
         incident.closed_at, incident.closure_reason,
         incident.observed_duration_ms, incident.last_failure_category
  INTO v_incident
  FROM monitoring.incidents AS incident
  WHERE incident.owner_id = v_intent.owner_id
    AND incident.check_id = v_intent.check_id
    AND incident.id = v_intent.incident_id
  FOR SHARE;

  SELECT check_row.name, check_row.group_id, check_row.lifecycle_state
  INTO v_check
  FROM app.checks AS check_row
  WHERE check_row.owner_id = v_intent.owner_id
    AND check_row.id = v_intent.check_id
  FOR SHARE;

  IF v_intent.event_kind = 'INCIDENT_OPENED' THEN
    IF v_incident.status IS DISTINCT FROM 'OPEN' THEN
      UPDATE notification.intents SET state = 'CANCELLED', decision_code = 'INCIDENT_CLOSED',
        maintenance_until = NULL, evaluated_at = statement_timestamp(),
        completed_at = statement_timestamp()
      WHERE id = v_intent.id;
      RETURN QUERY SELECT true, v_intent.id, 'CANCELLED'::text;
      RETURN;
    END IF;

    v_maintenance_until := app.effective_maintenance_until(
      v_intent.owner_id, v_intent.check_id, statement_timestamp()
    );
    IF v_maintenance_until IS NOT NULL THEN
      UPDATE notification.intents SET state = 'DEFERRED_MAINTENANCE',
        decision_code = 'MAINTENANCE', maintenance_until = v_maintenance_until,
        evaluated_at = statement_timestamp(), completed_at = NULL
      WHERE id = v_intent.id;
      RETURN QUERY SELECT true, v_intent.id, 'DEFERRED_MAINTENANCE'::text;
      RETURN;
    END IF;

    SELECT effective.id, effective.resource_version, effective.mode,
           effective.notify_down, effective.notify_recovery
    INTO v_policy
    FROM LATERAL (
      SELECT policy.*
      FROM notification.policies AS policy
      WHERE policy.owner_id = v_intent.owner_id
        AND policy.group_id IS NOT DISTINCT FROM v_check.group_id
      LIMIT 1
    ) AS scoped
    JOIN LATERAL (
      SELECT CASE WHEN scoped.mode = 'INHERIT' THEN defaults.id ELSE scoped.id END AS id,
             CASE WHEN scoped.mode = 'INHERIT' THEN defaults.resource_version ELSE scoped.resource_version END AS resource_version,
             CASE WHEN scoped.mode = 'INHERIT' THEN defaults.mode ELSE scoped.mode END AS mode,
             CASE WHEN scoped.mode = 'INHERIT' THEN defaults.notify_down ELSE scoped.notify_down END AS notify_down,
             CASE WHEN scoped.mode = 'INHERIT' THEN defaults.notify_recovery ELSE scoped.notify_recovery END AS notify_recovery
      FROM notification.policies AS defaults
      WHERE defaults.owner_id = v_intent.owner_id AND defaults.group_id IS NULL
    ) AS effective ON true;

    IF v_policy.id IS NULL OR v_policy.mode <> 'ACTIVE' OR v_policy.notify_down IS DISTINCT FROM true THEN
      UPDATE notification.intents SET state = 'CANCELLED', decision_code = 'POLICY_DISABLED',
        maintenance_until = NULL, evaluated_at = statement_timestamp(),
        completed_at = statement_timestamp()
      WHERE id = v_intent.id;
      RETURN QUERY SELECT true, v_intent.id, 'CANCELLED'::text;
      RETURN;
    END IF;

    v_template_key := 'INCIDENT_DOWN';
    v_template_payload := jsonb_build_object(
      'check_name', v_check.name,
      'started_at', v_incident.started_at,
      'confirmed_at', v_incident.confirmed_at,
      'failure_category', COALESCE(v_incident.last_failure_category, 'UNKNOWN')
    );

    INSERT INTO notification.deliveries (
      owner_id, intent_id, recipient_id, incident_id, event_kind,
      recipient_address_snapshot, max_attempts, recovery_enabled_snapshot
    )
    SELECT v_intent.owner_id, v_intent.id, recipient.id, v_intent.incident_id,
           v_intent.event_kind, recipient.email_display, 8, v_policy.notify_recovery
    FROM notification.policy_recipients AS link
    JOIN notification.recipients AS recipient
      ON recipient.owner_id = link.owner_id AND recipient.id = link.recipient_id
    WHERE link.owner_id = v_intent.owner_id AND link.policy_id = v_policy.id
      AND recipient.status = 'VERIFIED'
    ON CONFLICT (incident_id, event_kind, recipient_id) DO NOTHING;
    GET DIAGNOSTICS v_delivery_count = ROW_COUNT;

    UPDATE notification.intents SET
      state = CASE WHEN v_delivery_count = 0 THEN 'NO_RECIPIENTS' ELSE 'MATERIALIZED' END,
      decision_code = CASE WHEN v_delivery_count = 0 THEN 'NO_RECIPIENTS' ELSE 'READY' END,
      policy_id_snapshot = v_policy.id,
      policy_version_snapshot = v_policy.resource_version,
      template_key = v_template_key, template_version = 1,
      template_payload = v_template_payload, maintenance_until = NULL,
      evaluated_at = statement_timestamp(), completed_at = statement_timestamp()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT true, v_intent.id,
      CASE WHEN v_delivery_count = 0 THEN 'NO_RECIPIENTS' ELSE 'MATERIALIZED' END::text;
    RETURN;
  END IF;

  -- A close event cancels unsent DOWN work. A claim already in SMTP flight is
  -- marked for cancellation; its fenced completion decides the final lineage.
  UPDATE notification.deliveries AS delivery
  SET state = CASE WHEN delivery.state = 'PROCESSING' THEN delivery.state ELSE 'CANCELLED' END,
      cancel_requested_at = statement_timestamp(), cancel_reason = 'INCIDENT_CLOSED',
      completed_at = CASE WHEN delivery.state = 'PROCESSING' THEN NULL ELSE statement_timestamp() END,
      lease_owner = CASE WHEN delivery.state = 'PROCESSING' THEN delivery.lease_owner ELSE NULL END,
      lease_expires_at = CASE WHEN delivery.state = 'PROCESSING' THEN delivery.lease_expires_at ELSE NULL END,
      updated_at = statement_timestamp()
  WHERE delivery.incident_id = v_intent.incident_id
    AND delivery.event_kind = 'INCIDENT_OPENED'
    AND delivery.state IN ('PENDING', 'RETRY_WAIT', 'DEFERRED_MAINTENANCE', 'PROCESSING');

  IF v_incident.status IS DISTINCT FROM 'CLOSED'
     OR (v_intent.event_kind = 'INCIDENT_RECOVERED'
       AND v_incident.closure_reason IS DISTINCT FROM 'RECOVERED')
     OR (v_intent.event_kind = 'INCIDENT_CLOSED'
       AND v_incident.closure_reason NOT IN ('CONFIG_CHANGED', 'CHECK_DELETED')) THEN
    UPDATE notification.intents SET state = 'CANCELLED', decision_code = 'CLOSURE_NOT_ELIGIBLE',
      maintenance_until = NULL, evaluated_at = statement_timestamp(),
      completed_at = statement_timestamp()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT true, v_intent.id, 'CANCELLED'::text;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM notification.deliveries AS down_delivery
    JOIN notification.recipients AS recipient
      ON recipient.owner_id = down_delivery.owner_id
      AND recipient.id = down_delivery.recipient_id
    WHERE down_delivery.incident_id = v_intent.incident_id
      AND down_delivery.event_kind = 'INCIDENT_OPENED'
      AND down_delivery.state = 'SENT'
      AND down_delivery.recovery_enabled_snapshot = true
      AND recipient.status = 'VERIFIED'
  ) THEN
    UPDATE notification.intents SET state = 'CANCELLED', decision_code = 'NO_SENT_DOWN',
      maintenance_until = NULL, evaluated_at = statement_timestamp(),
      completed_at = statement_timestamp()
    WHERE id = v_intent.id;
    RETURN QUERY SELECT true, v_intent.id, 'CANCELLED'::text;
    RETURN;
  END IF;

  v_maintenance_until := app.effective_maintenance_until(
    v_intent.owner_id, v_intent.check_id, statement_timestamp()
  );
  IF v_maintenance_until IS NOT NULL THEN
    UPDATE notification.intents SET state = 'DEFERRED_MAINTENANCE',
      decision_code = 'MAINTENANCE', maintenance_until = v_maintenance_until,
      evaluated_at = statement_timestamp(), completed_at = NULL
    WHERE id = v_intent.id;
    RETURN QUERY SELECT true, v_intent.id, 'DEFERRED_MAINTENANCE'::text;
    RETURN;
  END IF;

  v_template_key := CASE WHEN v_intent.event_kind = 'INCIDENT_RECOVERED'
    THEN 'INCIDENT_RECOVERED' ELSE 'MONITORING_ENDED' END;
  v_template_payload := jsonb_build_object(
    'check_name', v_check.name,
    'started_at', v_incident.started_at,
    'ended_at', v_incident.closed_at,
    'observed_duration_ms', v_incident.observed_duration_ms::text,
    'wall_duration_ms', floor(extract(epoch FROM (v_incident.closed_at - v_incident.started_at)) * 1000)::bigint::text,
    'closure_reason', v_incident.closure_reason
  );

  INSERT INTO notification.deliveries (
    owner_id, intent_id, recipient_id, incident_id, event_kind,
    recipient_address_snapshot, max_attempts, related_down_delivery_id,
    recovery_enabled_snapshot
  )
  SELECT v_intent.owner_id, v_intent.id, down_delivery.recipient_id,
         v_intent.incident_id, v_intent.event_kind,
         down_delivery.recipient_address_snapshot, 8, down_delivery.id,
         down_delivery.recovery_enabled_snapshot
  FROM notification.deliveries AS down_delivery
  JOIN notification.recipients AS recipient
    ON recipient.owner_id = down_delivery.owner_id
    AND recipient.id = down_delivery.recipient_id
  WHERE down_delivery.incident_id = v_intent.incident_id
    AND down_delivery.event_kind = 'INCIDENT_OPENED'
    AND down_delivery.state = 'SENT'
    AND down_delivery.recovery_enabled_snapshot = true
    AND recipient.status = 'VERIFIED'
  ON CONFLICT (incident_id, event_kind, recipient_id) DO NOTHING;
  GET DIAGNOSTICS v_delivery_count = ROW_COUNT;

  UPDATE notification.intents SET state = 'MATERIALIZED', decision_code = 'READY',
    template_key = v_template_key, template_version = 1,
    template_payload = v_template_payload, maintenance_until = NULL,
    evaluated_at = statement_timestamp(), completed_at = statement_timestamp()
  WHERE id = v_intent.id;
  RETURN QUERY SELECT true, v_intent.id, 'MATERIALIZED'::text;
END
$function$;

CREATE FUNCTION security_api.claim_incident_notification_delivery(
  p_worker_id text,
  p_lease_seconds integer
)
RETURNS TABLE (
  delivery_id uuid,
  event_kind text,
  recipient_address text,
  template_key text,
  template_version smallint,
  template_payload jsonb,
  fencing_token bigint,
  attempt_count smallint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_delivery record;
  v_maintenance_until timestamptz;
BEGIN
  IF btrim(p_worker_id) = '' OR p_lease_seconds NOT BETWEEN 5 AND 900 THEN
    RAISE EXCEPTION 'invalid incident delivery claim parameters' USING ERRCODE = '22023';
  END IF;

  -- An expired SMTP lease has an ambiguous provider outcome. Terminalize it;
  -- never turn a process crash into an automatic duplicate e-mail.
  SELECT delivery.id, delivery.attempt_count INTO v_delivery
  FROM notification.deliveries AS delivery
  WHERE delivery.state = 'PROCESSING'
    AND delivery.lease_expires_at <= statement_timestamp()
  ORDER BY delivery.lease_expires_at, delivery.id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF FOUND THEN
    UPDATE notification.deliveries SET state = 'DELIVERY_UNKNOWN',
      completed_at = statement_timestamp(), lease_owner = NULL, lease_expires_at = NULL,
      last_result_code = 'lease_expired', updated_at = statement_timestamp()
    WHERE id = v_delivery.id;
    UPDATE notification.delivery_attempts SET ended_at = statement_timestamp(),
      result = 'DELIVERY_UNKNOWN', result_code = 'lease_expired'
    WHERE delivery_id = v_delivery.id AND attempt_number = v_delivery.attempt_count
      AND ended_at IS NULL;
    RETURN;
  END IF;

  SELECT delivery.id, delivery.owner_id, delivery.intent_id, delivery.recipient_id,
         delivery.incident_id, delivery.event_kind, delivery.recipient_address_snapshot,
         delivery.attempt_count, delivery.max_attempts, delivery.fencing_token,
         delivery.cancel_requested_at, intent.check_id, intent.template_key,
         intent.template_version, intent.template_payload, incident.status AS incident_status,
         recipient.status AS recipient_status, delivery.related_down_delivery_id
  INTO v_delivery
  FROM notification.deliveries AS delivery
  JOIN notification.intents AS intent ON intent.id = delivery.intent_id
  JOIN monitoring.incidents AS incident ON incident.id = delivery.incident_id
  JOIN notification.recipients AS recipient ON recipient.id = delivery.recipient_id
  WHERE delivery.state IN ('PENDING', 'RETRY_WAIT', 'DEFERRED_MAINTENANCE')
    AND delivery.available_at <= statement_timestamp()
  ORDER BY delivery.available_at, delivery.id
  FOR UPDATE OF delivery SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_delivery.cancel_requested_at IS NOT NULL
     OR v_delivery.recipient_status <> 'VERIFIED'
     OR (v_delivery.event_kind = 'INCIDENT_OPENED' AND v_delivery.incident_status <> 'OPEN')
     OR (v_delivery.event_kind <> 'INCIDENT_OPENED' AND NOT EXISTS (
       SELECT 1 FROM notification.deliveries AS down_delivery
       WHERE down_delivery.id = v_delivery.related_down_delivery_id
         AND down_delivery.state = 'SENT'
     )) THEN
    UPDATE notification.deliveries SET state = 'CANCELLED',
      completed_at = statement_timestamp(), lease_owner = NULL, lease_expires_at = NULL,
      cancel_requested_at = COALESCE(cancel_requested_at, statement_timestamp()),
      cancel_reason = COALESCE(cancel_reason, 'NOT_ELIGIBLE'), updated_at = statement_timestamp()
    WHERE id = v_delivery.id;
    RETURN;
  END IF;

  v_maintenance_until := app.effective_maintenance_until(
    v_delivery.owner_id, v_delivery.check_id, statement_timestamp()
  );
  IF v_maintenance_until IS NOT NULL THEN
    UPDATE notification.deliveries SET state = 'DEFERRED_MAINTENANCE',
      maintenance_until = v_maintenance_until, available_at = v_maintenance_until,
      lease_owner = NULL, lease_expires_at = NULL, updated_at = statement_timestamp()
    WHERE id = v_delivery.id;
    RETURN;
  END IF;

  UPDATE notification.deliveries AS delivery SET state = 'PROCESSING',
    maintenance_until = NULL, lease_owner = p_worker_id,
    lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
    fencing_token = delivery.fencing_token + 1,
    attempt_count = delivery.attempt_count + 1,
    updated_at = statement_timestamp()
  WHERE delivery.id = v_delivery.id
  RETURNING delivery.id, delivery.event_kind, delivery.recipient_address_snapshot,
    delivery.fencing_token, delivery.attempt_count
  INTO delivery_id, event_kind, recipient_address, fencing_token, attempt_count;

  INSERT INTO notification.delivery_attempts (
    delivery_id, attempt_number, fencing_token, started_at
  ) VALUES (delivery_id, attempt_count, fencing_token, statement_timestamp());

  template_key := v_delivery.template_key;
  template_version := v_delivery.template_version;
  template_payload := v_delivery.template_payload;
  RETURN NEXT;
END
$function$;

CREATE FUNCTION security_api.complete_incident_notification_delivery(
  p_delivery_id uuid,
  p_worker_id text,
  p_fencing_token bigint,
  p_result text,
  p_result_code text,
  p_provider_message_id text,
  p_retry_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_delivery record;
  v_final_state text;
BEGIN
  IF p_result NOT IN ('SENT', 'RETRY', 'FAILED', 'DELIVERY_UNKNOWN')
     OR btrim(p_result_code) = '' OR length(p_result_code) > 80
     OR p_retry_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid incident delivery completion' USING ERRCODE = '22023';
  END IF;

  SELECT delivery.attempt_count, delivery.max_attempts, delivery.cancel_requested_at
  INTO v_delivery
  FROM notification.deliveries AS delivery
  WHERE delivery.id = p_delivery_id AND delivery.state = 'PROCESSING'
    AND delivery.lease_owner = p_worker_id
    AND delivery.fencing_token = p_fencing_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_final_state := CASE
    WHEN p_result = 'SENT' THEN 'SENT'
    WHEN p_result = 'DELIVERY_UNKNOWN' THEN 'DELIVERY_UNKNOWN'
    WHEN v_delivery.cancel_requested_at IS NOT NULL THEN 'CANCELLED'
    WHEN p_result = 'RETRY' AND v_delivery.attempt_count < v_delivery.max_attempts THEN 'RETRY_WAIT'
    ELSE 'FAILED'
  END;

  UPDATE notification.deliveries SET state = v_final_state,
    provider_message_id = p_provider_message_id,
    last_result_code = p_result_code,
    available_at = CASE WHEN v_final_state = 'RETRY_WAIT'
      THEN statement_timestamp() + make_interval(secs => p_retry_seconds)
      ELSE available_at END,
    next_attempt_at = CASE WHEN v_final_state = 'RETRY_WAIT'
      THEN statement_timestamp() + make_interval(secs => p_retry_seconds)
      ELSE NULL END,
    sent_at = CASE WHEN v_final_state = 'SENT' THEN statement_timestamp() ELSE NULL END,
    completed_at = CASE WHEN v_final_state IN ('SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED')
      THEN statement_timestamp() ELSE NULL END,
    lease_owner = NULL, lease_expires_at = NULL, updated_at = statement_timestamp()
  WHERE id = p_delivery_id;

  UPDATE notification.delivery_attempts SET ended_at = statement_timestamp(),
    result = v_final_state, result_code = p_result_code,
    provider_message_id = p_provider_message_id
  WHERE delivery_id = p_delivery_id
    AND attempt_number = v_delivery.attempt_count
    AND fencing_token = p_fencing_token AND ended_at IS NULL;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION security_api.claim_notification_dispatch(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.complete_notification_dispatch(uuid, text, bigint, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.evaluate_notification_intent() FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.claim_incident_notification_delivery(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.complete_incident_notification_delivery(uuid, text, bigint, text, text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION security_api.claim_notification_dispatch(text, integer) TO site_monitor_notifier;
GRANT EXECUTE ON FUNCTION security_api.complete_notification_dispatch(uuid, text, bigint, text, text, integer) TO site_monitor_notifier;
GRANT EXECUTE ON FUNCTION security_api.evaluate_notification_intent() TO site_monitor_notifier;
GRANT EXECUTE ON FUNCTION security_api.claim_incident_notification_delivery(text, integer) TO site_monitor_notifier;
GRANT EXECUTE ON FUNCTION security_api.complete_incident_notification_delivery(uuid, text, bigint, text, text, text, integer) TO site_monitor_notifier;

REVOKE INSERT, UPDATE ON notification.intents FROM site_monitor_notifier;
REVOKE INSERT, UPDATE ON notification.deliveries FROM site_monitor_notifier;
REVOKE INSERT, UPDATE ON notification.delivery_attempts FROM site_monitor_notifier;
REVOKE UPDATE ON infra.outbox_dispatches FROM site_monitor_notifier;

COMMENT ON FUNCTION security_api.evaluate_notification_intent() IS
  'Atomically resolves one incident transition from current source tables and materializes idempotent recipient deliveries.';
COMMENT ON FUNCTION security_api.claim_incident_notification_delivery(text, integer) IS
  'Claims one eligible operational e-mail after recipient, incident, lineage, and maintenance revalidation.';

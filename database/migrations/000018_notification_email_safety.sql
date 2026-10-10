-- migrate:transaction true

-- Secret-bearing transactional messages share the same conservative SMTP
-- semantics as incident mail. An expired in-flight lease is ambiguous and is
-- never reclaimed automatically; definitive permanent failures terminate now.
CREATE OR REPLACE FUNCTION security_api.claim_transactional_email(
  p_worker_id text,
  p_lease_seconds integer
)
RETURNS TABLE (
  delivery_id uuid, owner_id uuid, purpose text, recipient_address text,
  encrypted_payload bytea, encryption_iv bytea, encryption_tag bytea,
  encryption_key_version text, fencing_token bigint, attempt_count smallint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_expired_id uuid;
BEGIN
  IF btrim(p_worker_id) = '' OR p_lease_seconds NOT BETWEEN 5 AND 900 THEN
    RAISE EXCEPTION 'invalid transactional email claim parameters' USING ERRCODE = '22023';
  END IF;

  SELECT delivery.id INTO v_expired_id
  FROM notification.transactional_email_deliveries AS delivery
  WHERE delivery.state = 'PROCESSING'
    AND delivery.lease_expires_at <= statement_timestamp()
  ORDER BY delivery.lease_expires_at, delivery.id
  FOR UPDATE SKIP LOCKED LIMIT 1;
  IF FOUND THEN
    UPDATE notification.transactional_email_deliveries
    SET state = 'DELIVERY_UNKNOWN', completed_at = statement_timestamp(),
        lease_owner = NULL, lease_expires_at = NULL,
        last_result_code = 'lease_expired', updated_at = statement_timestamp()
    WHERE id = v_expired_id;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate AS (
    SELECT id FROM notification.transactional_email_deliveries
    WHERE state IN ('PENDING', 'RETRY_WAIT')
      AND available_at <= statement_timestamp()
    ORDER BY available_at, created_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE notification.transactional_email_deliveries AS delivery
  SET state = 'PROCESSING', lease_owner = p_worker_id,
      lease_expires_at = statement_timestamp() + make_interval(secs => p_lease_seconds),
      fencing_token = delivery.fencing_token + 1,
      attempt_count = delivery.attempt_count + 1,
      updated_at = statement_timestamp()
  FROM candidate WHERE delivery.id = candidate.id
  RETURNING delivery.id, delivery.owner_id, delivery.purpose,
    delivery.recipient_address_snapshot::text, delivery.encrypted_payload,
    delivery.encryption_iv, delivery.encryption_tag, delivery.encryption_key_version,
    delivery.fencing_token, delivery.attempt_count;
END
$function$;

CREATE OR REPLACE FUNCTION security_api.complete_transactional_email(
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
  v_state text;
BEGIN
  IF p_result NOT IN ('SENT', 'RETRY', 'FAILED', 'DELIVERY_UNKNOWN')
     OR btrim(p_result_code) = '' OR length(p_result_code) > 80
     OR p_retry_seconds NOT BETWEEN 1 AND 3600 THEN
    RAISE EXCEPTION 'invalid transactional email completion' USING ERRCODE = '22023';
  END IF;

  SELECT CASE
      WHEN p_result = 'SENT' THEN 'SENT'
      WHEN p_result = 'FAILED' THEN 'FAILED'
      WHEN p_result = 'DELIVERY_UNKNOWN' THEN 'DELIVERY_UNKNOWN'
      WHEN delivery.attempt_count < delivery.max_attempts THEN 'RETRY_WAIT'
      ELSE 'FAILED'
    END
  INTO v_state
  FROM notification.transactional_email_deliveries AS delivery
  WHERE delivery.id = p_delivery_id AND delivery.state = 'PROCESSING'
    AND delivery.lease_owner = p_worker_id
    AND delivery.fencing_token = p_fencing_token
  FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE notification.transactional_email_deliveries
  SET state = v_state, provider_message_id = p_provider_message_id,
      last_result_code = p_result_code,
      available_at = CASE WHEN v_state = 'RETRY_WAIT'
        THEN statement_timestamp() + make_interval(secs => p_retry_seconds)
        ELSE available_at END,
      completed_at = CASE WHEN v_state IN ('SENT', 'FAILED', 'DELIVERY_UNKNOWN')
        THEN statement_timestamp() ELSE NULL END,
      lease_owner = NULL, lease_expires_at = NULL, updated_at = statement_timestamp()
  WHERE id = p_delivery_id;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION security_api.claim_transactional_email(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.complete_transactional_email(uuid, text, bigint, text, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.claim_transactional_email(text, integer) TO site_monitor_notifier;
GRANT EXECUTE ON FUNCTION security_api.complete_transactional_email(uuid, text, bigint, text, text, text, integer) TO site_monitor_notifier;

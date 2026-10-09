-- migrate:transaction true

CREATE FUNCTION security_api.begin_anonymous_idempotency(
  p_subject_digest bytea,
  p_operation text,
  p_key_digest bytea,
  p_request_hash bytea
)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_record infra.api_idempotency_records%ROWTYPE;
BEGIN
  DELETE FROM infra.api_idempotency_records
  WHERE owner_id IS NULL
    AND subject_digest = p_subject_digest
    AND operation = p_operation
    AND key_digest = p_key_digest
    AND expires_at <= statement_timestamp();

  INSERT INTO infra.api_idempotency_records (
    owner_id, subject_digest, operation, key_digest, request_hash,
    response_status, response_body, expires_at
  ) VALUES (
    NULL, p_subject_digest, p_operation, p_key_digest, p_request_hash,
    409, '{"state":"IN_PROGRESS"}'::jsonb, statement_timestamp() + interval '5 minutes'
  ) ON CONFLICT (subject_digest, operation, key_digest) DO NOTHING;

  IF FOUND THEN RETURN 'ACQUIRED'; END IF;

  SELECT * INTO v_record FROM infra.api_idempotency_records
  WHERE subject_digest = p_subject_digest
    AND operation = p_operation
    AND key_digest = p_key_digest
    AND owner_id IS NULL;
  IF v_record.request_hash <> p_request_hash THEN RETURN 'CONFLICT'; END IF;
  IF v_record.response_status = 409 THEN RETURN 'IN_PROGRESS'; END IF;
  RETURN 'REPLAY';
END
$function$;

CREATE FUNCTION security_api.complete_anonymous_idempotency(
  p_subject_digest bytea,
  p_operation text,
  p_key_digest bytea,
  p_request_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE infra.api_idempotency_records SET
    response_status = 202,
    response_body = '{"accepted":true}'::jsonb,
    expires_at = statement_timestamp() + interval '24 hours'
  WHERE owner_id IS NULL
    AND subject_digest = p_subject_digest
    AND operation = p_operation
    AND key_digest = p_key_digest
    AND request_hash = p_request_hash
    AND response_status = 409;
  RETURN FOUND;
END
$function$;

CREATE FUNCTION security_api.abandon_anonymous_idempotency(
  p_subject_digest bytea,
  p_operation text,
  p_key_digest bytea,
  p_request_hash bytea
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  DELETE FROM infra.api_idempotency_records
  WHERE owner_id IS NULL
    AND subject_digest = p_subject_digest
    AND operation = p_operation
    AND key_digest = p_key_digest
    AND request_hash = p_request_hash
    AND response_status = 409;
  RETURN FOUND;
END
$function$;

REVOKE ALL ON FUNCTION security_api.begin_anonymous_idempotency(bytea, text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.complete_anonymous_idempotency(bytea, text, bytea, bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.abandon_anonymous_idempotency(bytea, text, bytea, bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.begin_anonymous_idempotency(bytea, text, bytea, bytea) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.complete_anonymous_idempotency(bytea, text, bytea, bytea) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.abandon_anonymous_idempotency(bytea, text, bytea, bytea) TO site_monitor_api;

COMMENT ON FUNCTION security_api.begin_anonymous_idempotency(bytea, text, bytea, bytea) IS
  'Claims an anonymous auth command using only digests; raw idempotency keys and emails are forbidden.';

-- migrate:transaction true

ALTER TABLE auth.sessions
  ADD COLUMN absolute_expires_at timestamptz,
  ADD COLUMN idle_expires_at timestamptz,
  ADD COLUMN rotation_grace_expires_at timestamptz,
  ADD COLUMN rotated_to_session_id uuid REFERENCES auth.sessions (id) ON DELETE SET NULL,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT statement_timestamp();

UPDATE auth.sessions
SET
  absolute_expires_at = expires_at,
  idle_expires_at = LEAST(expires_at, COALESCE(last_seen_at, created_at) + interval '24 hours');

ALTER TABLE auth.sessions
  ALTER COLUMN absolute_expires_at SET NOT NULL,
  ALTER COLUMN idle_expires_at SET NOT NULL,
  ADD CONSTRAINT sessions_absolute_expiry_valid CHECK (absolute_expires_at > created_at),
  ADD CONSTRAINT sessions_idle_expiry_valid CHECK (
    idle_expires_at > created_at AND idle_expires_at <= absolute_expires_at
  ),
  ADD CONSTRAINT sessions_rotation_consistent CHECK (
    (rotated_to_session_id IS NULL AND rotation_grace_expires_at IS NULL)
    OR (rotated_to_session_id IS NOT NULL AND rotation_grace_expires_at IS NOT NULL)
  ),
  ADD CONSTRAINT sessions_no_self_rotation CHECK (rotated_to_session_id IS DISTINCT FROM id),
  ADD CONSTRAINT sessions_updated_valid CHECK (updated_at >= created_at);

CREATE INDEX sessions_runtime_lookup_idx
  ON auth.sessions (token_digest, idle_expires_at, absolute_expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE auth.rate_limit_counters (
  scope_digest bytea NOT NULL,
  policy text NOT NULL,
  bucket_start timestamptz NOT NULL,
  bucket_seconds integer NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope_digest, policy, bucket_start),
  CONSTRAINT rate_limit_scope_digest_length CHECK (octet_length(scope_digest) = 32),
  CONSTRAINT rate_limit_policy_valid CHECK (policy ~ '^[a-z][a-z0-9_.:-]{0,127}$'),
  CONSTRAINT rate_limit_bucket_seconds_valid CHECK (bucket_seconds BETWEEN 1 AND 172800),
  CONSTRAINT rate_limit_request_count_valid CHECK (request_count >= 1),
  CONSTRAINT rate_limit_expiry_valid CHECK (
    expires_at >= bucket_start + make_interval(secs => bucket_seconds)
    AND expires_at <= bucket_start + interval '48 hours'
  )
);

CREATE INDEX rate_limit_counters_expiry_idx ON auth.rate_limit_counters (expires_at);

CREATE TABLE notification.transactional_email_deliveries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  purpose text NOT NULL,
  recipient_address_snapshot varchar(320) NOT NULL,
  encrypted_payload bytea NOT NULL,
  encryption_iv bytea NOT NULL,
  encryption_tag bytea NOT NULL,
  encryption_key_version text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 8,
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,
  provider_message_id text,
  last_result_code text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT transactional_email_purpose_valid CHECK (
    purpose IN ('RESET_PASSWORD', 'VERIFY_ACCOUNT_EMAIL')
  ),
  CONSTRAINT transactional_email_recipient_not_blank CHECK (
    btrim(recipient_address_snapshot) <> ''
  ),
  CONSTRAINT transactional_email_encryption_valid CHECK (
    octet_length(encrypted_payload) BETWEEN 1 AND 65536
    AND octet_length(encryption_iv) = 12
    AND octet_length(encryption_tag) = 16
    AND btrim(encryption_key_version) <> ''
  ),
  CONSTRAINT transactional_email_state_valid CHECK (
    state IN ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'SENT', 'FAILED', 'DELIVERY_UNKNOWN')
  ),
  CONSTRAINT transactional_email_attempts_valid CHECK (
    attempt_count BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 20
  ),
  CONSTRAINT transactional_email_lease_consistent CHECK (
    (state = 'PROCESSING' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'PROCESSING' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT transactional_email_completion_consistent CHECK (
    (state IN ('SENT', 'FAILED', 'DELIVERY_UNKNOWN')) = (completed_at IS NOT NULL)
  ),
  CONSTRAINT transactional_email_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE INDEX transactional_email_claim_idx
  ON notification.transactional_email_deliveries (available_at, created_at, id)
  WHERE state IN ('PENDING', 'RETRY_WAIT');
CREATE INDEX transactional_email_owner_idx
  ON notification.transactional_email_deliveries (owner_id, created_at DESC, id);

ALTER TABLE auth.rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth.rate_limit_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE notification.transactional_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.transactional_email_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY schema_owner_all ON auth.rate_limit_counters
  TO site_monitor_schema_owner USING (true) WITH CHECK (true);
CREATE POLICY schema_owner_all ON notification.transactional_email_deliveries
  TO site_monitor_schema_owner USING (true) WITH CHECK (true);

DROP FUNCTION security_api.resolve_session(bytea);

CREATE FUNCTION security_api.resolve_session(p_token_digest bytea)
RETURNS TABLE (
  owner_id uuid,
  session_id uuid,
  created_at timestamptz,
  absolute_expires_at timestamptz,
  idle_expires_at timestamptz,
  rotation_grace_expires_at timestamptz,
  user_status text,
  issued_password_version integer,
  current_password_version integer,
  email_display text,
  display_name text,
  email_verified_at timestamptz,
  resource_version bigint,
  user_created_at timestamptz
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    session_row.owner_id,
    session_row.id,
    session_row.created_at,
    session_row.absolute_expires_at,
    session_row.idle_expires_at,
    session_row.rotation_grace_expires_at,
    user_row.status,
    session_row.issued_password_version,
    credential_row.password_version,
    user_row.email_display::text,
    user_row.display_name::text,
    user_row.email_verified_at,
    user_row.resource_version,
    user_row.created_at
  FROM auth.sessions AS session_row
  JOIN auth.users AS user_row ON user_row.id = session_row.owner_id
  JOIN auth.password_credentials AS credential_row ON credential_row.owner_id = user_row.id
  WHERE session_row.token_digest = p_token_digest
    AND session_row.revoked_at IS NULL
    AND session_row.absolute_expires_at > statement_timestamp()
    AND session_row.idle_expires_at > statement_timestamp()
    AND (
      session_row.rotated_to_session_id IS NULL
      OR session_row.rotation_grace_expires_at > statement_timestamp()
    )
    AND user_row.status = 'ACTIVE'
    AND session_row.issued_password_version = credential_row.password_version
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION security_api.lookup_login_credential(p_email_normalized text)
RETURNS TABLE (
  owner_id uuid,
  password_hash text,
  password_version integer,
  user_status text,
  email_verified_at timestamptz
)
LANGUAGE sql
VOLATILE
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

CREATE FUNCTION security_api.register_account(
  p_email_normalized text,
  p_email_display text,
  p_display_name text,
  p_password_hash text,
  p_token_digest bytea,
  p_expires_at timestamptz,
  p_encrypted_payload bytea,
  p_encryption_iv bytea,
  p_encryption_tag bytea,
  p_encryption_key_version text
)
RETURNS TABLE (created boolean, owner_id uuid)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  INSERT INTO auth.users (email_normalized, email_display, display_name)
  VALUES (p_email_normalized, p_email_display, p_display_name)
  ON CONFLICT (email_normalized) DO NOTHING
  RETURNING id INTO v_owner_id;

  IF v_owner_id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO auth.password_credentials (owner_id, password_hash)
  VALUES (v_owner_id, p_password_hash);
  INSERT INTO auth.one_time_tokens (owner_id, purpose, token_digest, expires_at)
  VALUES (v_owner_id, 'VERIFY_ACCOUNT_EMAIL', p_token_digest, p_expires_at);
  INSERT INTO notification.transactional_email_deliveries (
    owner_id, purpose, recipient_address_snapshot, encrypted_payload, encryption_iv,
    encryption_tag, encryption_key_version
  ) VALUES (
    v_owner_id, 'VERIFY_ACCOUNT_EMAIL', p_email_display, p_encrypted_payload,
    p_encryption_iv, p_encryption_tag, p_encryption_key_version
  );
  INSERT INTO audit.events (
    owner_id, actor_type, actor_id, action, resource_type, resource_id,
    result, correlation_id, occurred_at, metadata
  ) VALUES (
    v_owner_id, 'USER', v_owner_id::text, 'account.registered', 'user', v_owner_id,
    'SUCCESS', uuidv7(), statement_timestamp(), '{}'::jsonb
  );
  RETURN QUERY SELECT true, v_owner_id;
END
$function$;

CREATE FUNCTION security_api.issue_account_challenge(
  p_email_normalized text,
  p_purpose text,
  p_token_digest bytea,
  p_expires_at timestamptz,
  p_encrypted_payload bytea,
  p_encryption_iv bytea,
  p_encryption_tag bytea,
  p_encryption_key_version text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
  v_email_display text;
BEGIN
  SELECT id, email_display INTO v_owner_id, v_email_display
  FROM auth.users
  WHERE email_normalized = p_email_normalized
    AND (
      (p_purpose = 'VERIFY_ACCOUNT_EMAIL' AND status = 'PENDING_VERIFICATION')
      OR (p_purpose = 'RESET_PASSWORD' AND status = 'ACTIVE')
    )
  FOR UPDATE;
  IF v_owner_id IS NULL THEN RETURN false; END IF;

  UPDATE auth.one_time_tokens
  SET consumed_at = statement_timestamp()
  WHERE owner_id = v_owner_id AND purpose = p_purpose AND consumed_at IS NULL;
  INSERT INTO auth.one_time_tokens (owner_id, purpose, token_digest, expires_at)
  VALUES (v_owner_id, p_purpose, p_token_digest, p_expires_at);
  INSERT INTO notification.transactional_email_deliveries (
    owner_id, purpose, recipient_address_snapshot, encrypted_payload, encryption_iv,
    encryption_tag, encryption_key_version
  ) VALUES (
    v_owner_id, p_purpose, v_email_display, p_encrypted_payload,
    p_encryption_iv, p_encryption_tag, p_encryption_key_version
  );
  RETURN true;
END
$function$;

CREATE FUNCTION security_api.confirm_email_verification(p_token_digest bytea)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  UPDATE auth.one_time_tokens
  SET consumed_at = statement_timestamp()
  WHERE purpose = 'VERIFY_ACCOUNT_EMAIL'
    AND token_digest = p_token_digest
    AND consumed_at IS NULL
    AND expires_at > statement_timestamp()
  RETURNING owner_id INTO v_owner_id;
  IF v_owner_id IS NULL THEN RETURN false; END IF;

  UPDATE auth.users
  SET status = 'ACTIVE', email_verified_at = statement_timestamp(),
      resource_version = resource_version + 1, updated_at = statement_timestamp()
  WHERE id = v_owner_id AND status = 'PENDING_VERIFICATION';
  RETURN FOUND;
END
$function$;

CREATE FUNCTION security_api.complete_password_reset(
  p_token_digest bytea,
  p_password_hash text
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
BEGIN
  UPDATE auth.one_time_tokens
  SET consumed_at = statement_timestamp()
  WHERE purpose = 'RESET_PASSWORD'
    AND token_digest = p_token_digest
    AND consumed_at IS NULL
    AND expires_at > statement_timestamp()
  RETURNING owner_id INTO v_owner_id;
  IF v_owner_id IS NULL THEN RETURN false; END IF;

  UPDATE auth.password_credentials
  SET password_hash = p_password_hash, password_version = password_version + 1,
      changed_at = statement_timestamp()
  WHERE owner_id = v_owner_id;
  UPDATE auth.sessions
  SET revoked_at = statement_timestamp(), revoke_reason = 'PASSWORD_RESET',
      updated_at = statement_timestamp()
  WHERE owner_id = v_owner_id AND revoked_at IS NULL;
  UPDATE auth.one_time_tokens
  SET consumed_at = statement_timestamp()
  WHERE owner_id = v_owner_id AND consumed_at IS NULL;
  RETURN true;
END
$function$;

CREATE FUNCTION security_api.create_session(
  p_owner_id uuid,
  p_token_digest bytea,
  p_absolute_expires_at timestamptz,
  p_idle_expires_at timestamptz
)
RETURNS TABLE (session_id uuid, absolute_expires_at timestamptz, idle_expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN QUERY
  INSERT INTO auth.sessions (
    owner_id, token_digest, issued_password_version, expires_at,
    absolute_expires_at, idle_expires_at, last_seen_at
  )
  SELECT
    user_row.id, p_token_digest, credential_row.password_version, p_absolute_expires_at,
    p_absolute_expires_at, p_idle_expires_at, statement_timestamp()
  FROM auth.users AS user_row
  JOIN auth.password_credentials AS credential_row ON credential_row.owner_id = user_row.id
  WHERE user_row.id = p_owner_id AND user_row.status = 'ACTIVE'
  RETURNING id, auth.sessions.absolute_expires_at, auth.sessions.idle_expires_at;
END
$function$;

CREATE FUNCTION security_api.touch_or_rotate_session(
  p_token_digest bytea,
  p_new_token_digest bytea,
  p_idle_expires_at timestamptz,
  p_rotation_grace_expires_at timestamptz
)
RETURNS TABLE (session_id uuid, rotated boolean, absolute_expires_at timestamptz, idle_expires_at timestamptz)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_session auth.sessions%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_session FROM auth.sessions
  WHERE token_digest = p_token_digest AND revoked_at IS NULL
  FOR UPDATE;
  IF v_session.id IS NULL
    OR v_session.absolute_expires_at <= statement_timestamp()
    OR v_session.idle_expires_at <= statement_timestamp()
    OR (v_session.rotated_to_session_id IS NOT NULL AND v_session.rotation_grace_expires_at <= statement_timestamp())
  THEN RETURN; END IF;

  IF v_session.created_at <= statement_timestamp() - interval '24 hours'
    AND v_session.rotated_to_session_id IS NULL
  THEN
    INSERT INTO auth.sessions (
      owner_id, token_digest, issued_password_version, expires_at, absolute_expires_at,
      idle_expires_at, last_seen_at, rotated_from_session_id
    ) VALUES (
      v_session.owner_id, p_new_token_digest, v_session.issued_password_version,
      v_session.absolute_expires_at, v_session.absolute_expires_at,
      LEAST(p_idle_expires_at, v_session.absolute_expires_at), statement_timestamp(), v_session.id
    ) RETURNING id INTO v_new_id;
    UPDATE auth.sessions SET
      rotated_to_session_id = v_new_id,
      rotation_grace_expires_at = p_rotation_grace_expires_at,
      last_seen_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE id = v_session.id;
    RETURN QUERY SELECT v_new_id, true, v_session.absolute_expires_at,
      LEAST(p_idle_expires_at, v_session.absolute_expires_at);
  ELSE
    UPDATE auth.sessions SET
      last_seen_at = statement_timestamp(),
      idle_expires_at = LEAST(p_idle_expires_at, absolute_expires_at),
      updated_at = statement_timestamp()
    WHERE id = v_session.id;
    RETURN QUERY SELECT v_session.id, false, v_session.absolute_expires_at,
      LEAST(p_idle_expires_at, v_session.absolute_expires_at);
  END IF;
END
$function$;

CREATE FUNCTION security_api.revoke_session(p_token_digest bytea, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE auth.sessions SET
    revoked_at = statement_timestamp(), revoke_reason = p_reason,
    updated_at = statement_timestamp()
  WHERE token_digest = p_token_digest AND revoked_at IS NULL;
  RETURN FOUND;
END
$function$;

CREATE FUNCTION security_api.consume_rate_limit(
  p_scope_digest bytea,
  p_policy text,
  p_limit integer,
  p_bucket_seconds integer
)
RETURNS TABLE (allowed boolean, remaining integer, retry_after_seconds integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_bucket timestamptz;
  v_count integer;
BEGIN
  v_bucket := to_timestamp(floor(extract(epoch FROM v_now) / p_bucket_seconds) * p_bucket_seconds);
  INSERT INTO auth.rate_limit_counters (
    scope_digest, policy, bucket_start, bucket_seconds, request_count, expires_at
  ) VALUES (
    p_scope_digest, p_policy, v_bucket, p_bucket_seconds, 1,
    LEAST(v_bucket + make_interval(secs => p_bucket_seconds) + interval '1 hour', v_bucket + interval '48 hours')
  )
  ON CONFLICT (scope_digest, policy, bucket_start)
  DO UPDATE SET request_count = auth.rate_limit_counters.request_count + 1
  RETURNING request_count INTO v_count;
  RETURN QUERY SELECT
    v_count <= p_limit,
    GREATEST(p_limit - v_count, 0),
    GREATEST(ceil(extract(epoch FROM (v_bucket + make_interval(secs => p_bucket_seconds) - v_now)))::integer, 0);
END
$function$;

CREATE FUNCTION security_api.claim_transactional_email(
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
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT id FROM notification.transactional_email_deliveries
    WHERE (
      state IN ('PENDING', 'RETRY_WAIT') AND available_at <= statement_timestamp()
    ) OR (
      state = 'PROCESSING' AND lease_expires_at <= statement_timestamp()
    )
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

CREATE FUNCTION security_api.complete_transactional_email(
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
BEGIN
  UPDATE notification.transactional_email_deliveries
  SET
    state = CASE
      WHEN p_result = 'SENT' THEN 'SENT'
      WHEN p_result = 'DELIVERY_UNKNOWN' THEN 'DELIVERY_UNKNOWN'
      WHEN p_result = 'RETRY' AND attempt_count < max_attempts THEN 'RETRY_WAIT'
      ELSE 'FAILED'
    END,
    provider_message_id = p_provider_message_id,
    last_result_code = p_result_code,
    available_at = CASE WHEN p_result = 'RETRY' THEN statement_timestamp() + make_interval(secs => p_retry_seconds) ELSE available_at END,
    completed_at = CASE WHEN p_result IN ('SENT', 'DELIVERY_UNKNOWN') OR attempt_count >= max_attempts THEN statement_timestamp() ELSE NULL END,
    lease_owner = NULL, lease_expires_at = NULL, updated_at = statement_timestamp()
  WHERE id = p_delivery_id AND state = 'PROCESSING'
    AND lease_owner = p_worker_id AND fencing_token = p_fencing_token;
  RETURN FOUND;
END
$function$;

REVOKE EXECUTE ON FUNCTION security_api.consume_one_time_token(text, bytea) FROM site_monitor_api;

REVOKE ALL ON FUNCTION security_api.register_account(text, text, text, text, bytea, timestamptz, bytea, bytea, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.issue_account_challenge(text, text, bytea, timestamptz, bytea, bytea, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.confirm_email_verification(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.complete_password_reset(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.create_session(uuid, bytea, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.touch_or_rotate_session(bytea, bytea, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.revoke_session(bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.consume_rate_limit(bytea, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.claim_transactional_email(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.complete_transactional_email(uuid, text, bigint, text, text, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION security_api.register_account(text, text, text, text, bytea, timestamptz, bytea, bytea, bytea, text) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.issue_account_challenge(text, text, bytea, timestamptz, bytea, bytea, bytea, text) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.confirm_email_verification(bytea) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.complete_password_reset(bytea, text) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.create_session(uuid, bytea, timestamptz, timestamptz) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.touch_or_rotate_session(bytea, bytea, timestamptz, timestamptz) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.revoke_session(bytea, text) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.consume_rate_limit(bytea, text, integer, integer) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.claim_transactional_email(text, integer) TO site_monitor_notifier;
GRANT EXECUTE ON FUNCTION security_api.complete_transactional_email(uuid, text, bigint, text, text, text, integer) TO site_monitor_notifier;

COMMENT ON TABLE auth.rate_limit_counters IS
  'Distributed fixed-window auth throttles keyed only by HMAC digests; raw IP and email values are forbidden.';
COMMENT ON TABLE notification.transactional_email_deliveries IS
  'Durable verification and password-reset email queue. Secret-bearing payloads are AES-256-GCM ciphertext.';

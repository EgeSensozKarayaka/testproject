-- migrate:transaction true

-- Every account has exactly one owner-wide default. New accounts receive the
-- safe DISABLED default inside the account-creation transaction; existing
-- accounts and groups are reconciled before API activation.
CREATE FUNCTION notification.ensure_default_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  INSERT INTO notification.policies
    (owner_id, group_id, mode, notify_down, notify_recovery)
  VALUES (NEW.id, NULL, 'DISABLED', NULL, NULL)
  ON CONFLICT (owner_id, group_id) DO NOTHING;
  RETURN NEW;
END
$function$;

CREATE TRIGGER users_ensure_default_notification_policy
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION notification.ensure_default_policy();

INSERT INTO notification.policies
  (owner_id, group_id, mode, notify_down, notify_recovery)
SELECT user_row.id, NULL, 'DISABLED', NULL, NULL
FROM auth.users AS user_row
ON CONFLICT (owner_id, group_id) DO NOTHING;

INSERT INTO notification.policies
  (owner_id, group_id, mode, notify_down, notify_recovery)
SELECT group_row.owner_id, group_row.id, 'INHERIT', NULL, NULL
FROM app.check_groups AS group_row
ON CONFLICT (owner_id, group_id) DO NOTHING;

REVOKE ALL ON FUNCTION notification.ensure_default_policy() FROM PUBLIC;

-- Recipient verification and test messages reuse the encrypted transactional
-- queue. The nullable recipient lineage is forbidden for account messages and
-- required for recipient messages.
ALTER TABLE notification.transactional_email_deliveries
  ADD COLUMN recipient_id uuid;

ALTER TABLE notification.transactional_email_deliveries
  ADD CONSTRAINT transactional_email_recipient_fk
    FOREIGN KEY (owner_id, recipient_id)
    REFERENCES notification.recipients (owner_id, id) ON DELETE RESTRICT,
  DROP CONSTRAINT transactional_email_purpose_valid,
  ADD CONSTRAINT transactional_email_purpose_valid CHECK (
    purpose IN (
      'RESET_PASSWORD', 'VERIFY_ACCOUNT_EMAIL',
      'VERIFY_NOTIFICATION_RECIPIENT', 'TEST_NOTIFICATION'
    )
  ),
  ADD CONSTRAINT transactional_email_recipient_consistent CHECK (
    (purpose IN ('RESET_PASSWORD', 'VERIFY_ACCOUNT_EMAIL') AND recipient_id IS NULL)
    OR
    (purpose IN ('VERIFY_NOTIFICATION_RECIPIENT', 'TEST_NOTIFICATION') AND recipient_id IS NOT NULL)
  ),
  DROP CONSTRAINT transactional_email_state_valid,
  ADD CONSTRAINT transactional_email_state_valid CHECK (
    state IN ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED')
  ),
  DROP CONSTRAINT transactional_email_completion_consistent,
  ADD CONSTRAINT transactional_email_completion_consistent CHECK (
    (state IN ('SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED')) = (completed_at IS NOT NULL)
  );

CREATE INDEX transactional_email_recipient_open_idx
  ON notification.transactional_email_deliveries (owner_id, recipient_id, created_at, id)
  WHERE recipient_id IS NOT NULL AND state IN ('PENDING', 'PROCESSING', 'RETRY_WAIT');

CREATE FUNCTION security_api.enqueue_recipient_transactional_email(
  p_owner_id uuid,
  p_recipient_id uuid,
  p_purpose text,
  p_recipient_address text,
  p_encrypted_payload bytea,
  p_encryption_iv bytea,
  p_encryption_tag bytea,
  p_encryption_key_version text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_delivery_id uuid;
BEGIN
  IF p_owner_id IS DISTINCT FROM security_api.current_owner_id() THEN
    RAISE EXCEPTION 'owner context mismatch' USING ERRCODE = '42501';
  END IF;
  IF p_purpose NOT IN ('VERIFY_NOTIFICATION_RECIPIENT', 'TEST_NOTIFICATION') THEN
    RAISE EXCEPTION 'unsupported recipient email purpose' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notification.recipients
    WHERE owner_id = p_owner_id AND id = p_recipient_id
  ) THEN
    RAISE EXCEPTION 'recipient not found' USING ERRCODE = '23503';
  END IF;

  INSERT INTO notification.transactional_email_deliveries (
    owner_id, recipient_id, purpose, recipient_address_snapshot,
    encrypted_payload, encryption_iv, encryption_tag, encryption_key_version
  ) VALUES (
    p_owner_id, p_recipient_id, p_purpose, p_recipient_address,
    p_encrypted_payload, p_encryption_iv, p_encryption_tag, p_encryption_key_version
  ) RETURNING id INTO v_delivery_id;
  RETURN v_delivery_id;
END
$function$;

CREATE FUNCTION security_api.cancel_recipient_transactional_emails(
  p_owner_id uuid,
  p_recipient_id uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF p_owner_id IS DISTINCT FROM security_api.current_owner_id() THEN
    RAISE EXCEPTION 'owner context mismatch' USING ERRCODE = '42501';
  END IF;
  UPDATE notification.transactional_email_deliveries AS delivery
  SET state = 'CANCELLED', completed_at = statement_timestamp(),
      lease_owner = NULL, lease_expires_at = NULL, updated_at = statement_timestamp(),
      last_result_code = 'recipient_disabled'
  WHERE owner_id = p_owner_id AND recipient_id = p_recipient_id
    AND state IN ('PENDING', 'RETRY_WAIT');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

CREATE FUNCTION security_api.confirm_notification_recipient(
  p_token_digest bytea,
  p_correlation_id uuid
)
RETURNS TABLE (owner_id uuid, recipient_id uuid, resource_version bigint)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_id uuid;
  v_recipient_id uuid;
  v_resource_version bigint;
  v_event_id uuid;
BEGIN
  UPDATE notification.recipient_verification_tokens
  SET consumed_at = statement_timestamp()
  WHERE token_digest = p_token_digest AND consumed_at IS NULL
    AND expires_at > statement_timestamp()
  RETURNING notification.recipient_verification_tokens.owner_id,
            notification.recipient_verification_tokens.recipient_id
  INTO v_owner_id, v_recipient_id;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  UPDATE notification.recipients
  SET status = 'VERIFIED', verified_at = statement_timestamp(), disabled_at = NULL,
      resource_version = notification.recipients.resource_version + 1,
      updated_at = statement_timestamp()
  WHERE notification.recipients.owner_id = v_owner_id
    AND notification.recipients.id = v_recipient_id
    AND status = 'PENDING_VERIFICATION'
  RETURNING notification.recipients.resource_version INTO v_resource_version;
  IF v_resource_version IS NULL THEN RETURN; END IF;

  UPDATE notification.transactional_email_deliveries AS delivery
  SET state = 'CANCELLED', completed_at = statement_timestamp(),
      updated_at = statement_timestamp(), last_result_code = 'recipient_verified'
  WHERE delivery.owner_id = v_owner_id AND delivery.recipient_id = v_recipient_id
    AND delivery.purpose = 'VERIFY_NOTIFICATION_RECIPIENT'
    AND delivery.state IN ('PENDING', 'RETRY_WAIT');

  INSERT INTO infra.outbox_events (
    owner_id, event_type, schema_version, aggregate_type, aggregate_id,
    aggregate_version, correlation_id, occurred_at, payload
  ) VALUES (
    v_owner_id, 'notification.recipient_verified', 1, 'notification_recipient',
    v_recipient_id, v_resource_version, p_correlation_id, statement_timestamp(),
    jsonb_build_object('recipient_id', v_recipient_id, 'resource_version', v_resource_version::text)
  ) RETURNING id INTO v_event_id;
  IF EXISTS (
    SELECT 1 FROM infra.destination_activations WHERE destination = 'REALTIME'
  ) THEN
    INSERT INTO infra.outbox_dispatches (event_id, destination)
    VALUES (v_event_id, 'REALTIME');
  END IF;
  INSERT INTO audit.events (
    owner_id, actor_type, actor_id, action, resource_type, resource_id,
    correlation_id, result, occurred_at, metadata
  ) VALUES (
    v_owner_id, 'USER', v_owner_id::text, 'notification.recipient_verified',
    'notification_recipient', v_recipient_id, p_correlation_id, 'SUCCESS',
    statement_timestamp(), '{}'::jsonb
  );

  RETURN QUERY SELECT v_owner_id, v_recipient_id, v_resource_version;
END
$function$;

REVOKE ALL ON FUNCTION security_api.enqueue_recipient_transactional_email(uuid, uuid, text, text, bytea, bytea, bytea, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.cancel_recipient_transactional_emails(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.confirm_notification_recipient(bytea, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.enqueue_recipient_transactional_email(uuid, uuid, text, text, bytea, bytea, bytea, text) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.cancel_recipient_transactional_emails(uuid, uuid) TO site_monitor_api;
GRANT EXECUTE ON FUNCTION security_api.confirm_notification_recipient(bytea, uuid) TO site_monitor_api;

-- Prepare durable incident notification records without activating the
-- NOTIFICATION destination. Runtime claim/complete functions arrive with the
-- incident consumer in the next slice.
ALTER TABLE notification.intents
  ADD COLUMN decision_code text,
  ADD COLUMN policy_id_snapshot uuid,
  ADD COLUMN template_key text,
  ADD COLUMN template_version smallint,
  ADD COLUMN template_payload jsonb,
  DROP CONSTRAINT notification_intents_kind_valid,
  ADD CONSTRAINT notification_intents_kind_valid CHECK (
    event_kind IN ('INCIDENT_OPENED', 'INCIDENT_RECOVERED', 'INCIDENT_CLOSED')
  ),
  ADD CONSTRAINT notification_intents_template_consistent CHECK (
    (template_key IS NULL AND template_version IS NULL AND template_payload IS NULL)
    OR
    (btrim(template_key) <> '' AND template_version >= 1
      AND jsonb_typeof(template_payload) = 'object'
      AND octet_length(template_payload::text) <= 32768)
  );

ALTER TABLE notification.deliveries
  ADD COLUMN maintenance_until timestamptz,
  ADD COLUMN related_down_delivery_id uuid REFERENCES notification.deliveries (id) ON DELETE RESTRICT,
  ADD COLUMN recovery_enabled_snapshot boolean,
  ADD COLUMN cancel_requested_at timestamptz,
  ADD COLUMN cancel_reason text,
  DROP CONSTRAINT notification_deliveries_kind_valid,
  ADD CONSTRAINT notification_deliveries_kind_valid CHECK (
    event_kind IN ('INCIDENT_OPENED', 'INCIDENT_RECOVERED', 'INCIDENT_CLOSED')
  ),
  DROP CONSTRAINT notification_deliveries_state_valid,
  ADD CONSTRAINT notification_deliveries_state_valid CHECK (
    state IN (
      'PENDING', 'PROCESSING', 'RETRY_WAIT', 'DEFERRED_MAINTENANCE',
      'SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED'
    )
  ),
  ADD CONSTRAINT notification_deliveries_maintenance_consistent CHECK (
    (state = 'DEFERRED_MAINTENANCE' AND maintenance_until IS NOT NULL)
    OR state <> 'DEFERRED_MAINTENANCE'
  ),
  ADD CONSTRAINT notification_deliveries_cancellation_consistent CHECK (
    (cancel_requested_at IS NULL AND cancel_reason IS NULL)
    OR (cancel_requested_at IS NOT NULL AND btrim(cancel_reason) <> '')
  );

DROP INDEX notification.notification_deliveries_claim_idx;
CREATE INDEX notification_deliveries_claim_idx
  ON notification.deliveries (available_at, id)
  WHERE state IN ('PENDING', 'RETRY_WAIT', 'DEFERRED_MAINTENANCE');

CREATE TABLE notification.delivery_attempts (
  delivery_id uuid NOT NULL REFERENCES notification.deliveries (id) ON DELETE RESTRICT,
  attempt_number smallint NOT NULL CHECK (attempt_number >= 1),
  fencing_token bigint NOT NULL CHECK (fencing_token >= 1),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  result text,
  result_code text,
  provider_message_id text,
  PRIMARY KEY (delivery_id, attempt_number),
  CONSTRAINT notification_delivery_attempt_end_valid CHECK (
    (ended_at IS NULL AND result IS NULL)
    OR (ended_at >= started_at AND btrim(result) <> '')
  )
);

ALTER TABLE notification.delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.delivery_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY schema_owner_all ON notification.delivery_attempts
  TO site_monitor_schema_owner USING (true) WITH CHECK (true);
CREATE POLICY api_owner_access ON notification.delivery_attempts
  TO site_monitor_api
  USING (EXISTS (
    SELECT 1 FROM notification.deliveries AS delivery
    WHERE delivery.id = delivery_id AND delivery.owner_id = security_api.current_owner_id()
  ));
CREATE POLICY notifier_all_tenants ON notification.delivery_attempts
  TO site_monitor_notifier USING (true) WITH CHECK (true);

GRANT SELECT ON notification.delivery_attempts TO site_monitor_api;
GRANT SELECT, INSERT, UPDATE ON notification.delivery_attempts TO site_monitor_notifier;

COMMENT ON FUNCTION security_api.confirm_notification_recipient(bytea, uuid) IS
  'Single-use public confirmation boundary that atomically verifies a recipient and emits audit/realtime evidence.';
COMMENT ON TABLE notification.delivery_attempts IS
  'Immutable-per-attempt SMTP evidence for incident notification deliveries; runtime activation is intentionally deferred.';

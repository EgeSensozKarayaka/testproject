-- migrate:transaction true

CREATE TABLE infra.api_idempotency_records (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid REFERENCES auth.users (id) ON DELETE CASCADE,
  subject_digest bytea NOT NULL,
  operation text NOT NULL,
  key_digest bytea NOT NULL,
  request_hash bytea NOT NULL,
  response_status smallint NOT NULL,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_body jsonb,
  encrypted_response bytea,
  encryption_key_version text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT api_idempotency_records_scope_unique UNIQUE (subject_digest, operation, key_digest),
  CONSTRAINT api_idempotency_records_subject_digest_length CHECK (octet_length(subject_digest) = 32),
  CONSTRAINT api_idempotency_records_key_digest_length CHECK (octet_length(key_digest) = 32),
  CONSTRAINT api_idempotency_records_request_hash_length CHECK (octet_length(request_hash) = 32),
  CONSTRAINT api_idempotency_records_operation_valid CHECK (
    operation ~ '^[a-z][a-z0-9_.:-]{0,127}$'
  ),
  CONSTRAINT api_idempotency_records_response_status_valid CHECK (
    response_status BETWEEN 200 AND 499
  ),
  CONSTRAINT api_idempotency_records_response_headers_valid CHECK (
    jsonb_typeof(response_headers) = 'object'
    AND octet_length(response_headers::text) <= 2048
    AND response_headers - ARRAY['Location', 'ETag']::text[] = '{}'::jsonb
  ),
  CONSTRAINT api_idempotency_records_response_body_valid CHECK (
    response_body IS NULL
    OR (jsonb_typeof(response_body) = 'object' AND octet_length(response_body::text) <= 65536)
  ),
  CONSTRAINT api_idempotency_records_encryption_consistent CHECK (
    (encrypted_response IS NULL AND encryption_key_version IS NULL)
    OR (
      encrypted_response IS NOT NULL
      AND octet_length(encrypted_response) BETWEEN 17 AND 65536
      AND encryption_key_version IS NOT NULL
      AND btrim(encryption_key_version) <> ''
      AND response_body IS NULL
    )
  ),
  CONSTRAINT api_idempotency_records_expiry_valid CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '7 days'
  )
);

CREATE INDEX api_idempotency_records_expiry_idx
  ON infra.api_idempotency_records (expires_at, id);
CREATE INDEX api_idempotency_records_owner_created_idx
  ON infra.api_idempotency_records (owner_id, created_at DESC, id)
  WHERE owner_id IS NOT NULL;

ALTER TABLE infra.api_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE infra.api_idempotency_records FORCE ROW LEVEL SECURITY;

CREATE POLICY schema_owner_all ON infra.api_idempotency_records
  TO site_monitor_schema_owner
  USING (true)
  WITH CHECK (true);

CREATE POLICY api_owner_access ON infra.api_idempotency_records
  TO site_monitor_api
  USING (owner_id = security_api.current_owner_id())
  WITH CHECK (owner_id = security_api.current_owner_id());

CREATE POLICY housekeeper_expired_delete ON infra.api_idempotency_records
  FOR DELETE
  TO site_monitor_housekeeper
  USING (expires_at <= statement_timestamp());

GRANT SELECT, INSERT ON infra.api_idempotency_records TO site_monitor_api;
GRANT DELETE ON infra.api_idempotency_records TO site_monitor_housekeeper;

COMMENT ON TABLE infra.api_idempotency_records IS
  'Bounded HTTP idempotency receipts. Raw keys, email addresses, tokens, and plaintext secret responses are forbidden.';
COMMENT ON COLUMN infra.api_idempotency_records.owner_id IS
  'Authenticated owner when available. Anonymous receipts require a later narrow security_api function; direct API RLS access intentionally rejects them.';

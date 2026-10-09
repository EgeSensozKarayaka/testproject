-- migrate:transaction true

CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  email_normalized varchar(320) NOT NULL,
  email_display varchar(320) NOT NULL,
  display_name varchar(120) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_VERIFICATION',
  email_verified_at timestamptz,
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT users_email_normalized_unique UNIQUE (email_normalized),
  CONSTRAINT users_email_not_blank CHECK (btrim(email_normalized) <> '' AND btrim(email_display) <> ''),
  CONSTRAINT users_display_name_not_blank CHECK (btrim(display_name) <> ''),
  CONSTRAINT users_status_valid CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'DISABLED', 'DELETION_REQUESTED')),
  CONSTRAINT users_verification_consistent CHECK (status <> 'ACTIVE' OR email_verified_at IS NOT NULL),
  CONSTRAINT users_deletion_consistent CHECK ((status = 'DELETION_REQUESTED') = (deletion_requested_at IS NOT NULL)),
  CONSTRAINT users_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE TABLE auth.password_credentials (
  owner_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  password_version integer NOT NULL DEFAULT 1 CHECK (password_version >= 1),
  changed_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT password_credentials_hash_not_blank CHECK (btrim(password_hash) <> '')
);

CREATE TABLE auth.sessions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  token_digest bytea NOT NULL,
  issued_password_version integer NOT NULL CHECK (issued_password_version >= 1),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  rotated_from_session_id uuid REFERENCES auth.sessions (id) ON DELETE SET NULL,
  CONSTRAINT sessions_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT sessions_token_digest_unique UNIQUE (token_digest),
  CONSTRAINT sessions_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT sessions_revocation_consistent CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT sessions_digest_length CHECK (octet_length(token_digest) = 32)
);

CREATE INDEX sessions_owner_active_idx ON auth.sessions (owner_id, expires_at DESC)
WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON auth.sessions (expires_at);

CREATE TABLE auth.one_time_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  purpose text NOT NULL,
  token_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT one_time_tokens_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT one_time_tokens_digest_unique UNIQUE (token_digest),
  CONSTRAINT one_time_tokens_purpose_valid CHECK (purpose IN ('VERIFY_ACCOUNT_EMAIL', 'RESET_PASSWORD')),
  CONSTRAINT one_time_tokens_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT one_time_tokens_consumed_valid CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  CONSTRAINT one_time_tokens_digest_length CHECK (octet_length(token_digest) = 32)
);

CREATE INDEX one_time_tokens_open_idx ON auth.one_time_tokens (owner_id, purpose, expires_at)
WHERE consumed_at IS NULL;

CREATE TABLE app.check_groups (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  name varchar(160) NOT NULL,
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT check_groups_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT check_groups_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT check_groups_timestamps_valid CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at))
);

CREATE INDEX check_groups_owner_live_idx ON app.check_groups (owner_id, created_at DESC, id)
WHERE deleted_at IS NULL;

CREATE TABLE app.checks (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  group_id uuid,
  name varchar(160) NOT NULL,
  url varchar(4096) NOT NULL,
  interval_seconds smallint NOT NULL,
  timeout_ms integer NOT NULL,
  expected_status_code smallint NOT NULL,
  expected_body_substring varchar(2048),
  lifecycle_state text NOT NULL DEFAULT 'LIVE',
  execution_state text NOT NULL DEFAULT 'ACTIVE',
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  probe_generation bigint NOT NULL DEFAULT 1 CHECK (probe_generation >= 1),
  schedule_generation bigint NOT NULL DEFAULT 1 CHECK (schedule_generation >= 1),
  cadence_anchor_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  next_run_at timestamptz,
  manual_requested_at timestamptz,
  next_fencing_token bigint NOT NULL DEFAULT 1 CHECK (next_fencing_token >= 1),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  deleted_at timestamptz,
  CONSTRAINT checks_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT checks_owner_group_fk FOREIGN KEY (owner_id, group_id)
    REFERENCES app.check_groups (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT checks_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT checks_url_not_blank CHECK (btrim(url) <> ''),
  CONSTRAINT checks_interval_valid CHECK (interval_seconds BETWEEN 30 AND 3600),
  CONSTRAINT checks_timeout_valid CHECK (timeout_ms BETWEEN 1 AND 300000),
  CONSTRAINT checks_expected_status_valid CHECK (expected_status_code BETWEEN 100 AND 599),
  CONSTRAINT checks_lifecycle_valid CHECK (lifecycle_state IN ('LIVE', 'DELETED')),
  CONSTRAINT checks_execution_valid CHECK (execution_state IN ('ACTIVE', 'PAUSED')),
  CONSTRAINT checks_schedule_consistent CHECK (
    (lifecycle_state = 'LIVE' AND execution_state = 'ACTIVE' AND next_run_at IS NOT NULL)
    OR ((lifecycle_state = 'DELETED' OR execution_state = 'PAUSED') AND next_run_at IS NULL)
  ),
  CONSTRAINT checks_delete_consistent CHECK ((lifecycle_state = 'DELETED') = (deleted_at IS NOT NULL)),
  CONSTRAINT checks_timestamps_valid CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at))
);

CREATE INDEX checks_owner_list_idx
  ON app.checks (owner_id, lifecycle_state, created_at DESC, id)
  INCLUDE (name, group_id, execution_state);
CREATE INDEX checks_owner_group_idx ON app.checks (owner_id, group_id, lifecycle_state, id);
CREATE INDEX checks_due_idx ON app.checks (next_run_at, id)
WHERE lifecycle_state = 'LIVE' AND execution_state = 'ACTIVE';
CREATE INDEX checks_manual_pending_idx ON app.checks (manual_requested_at, id)
WHERE manual_requested_at IS NOT NULL AND lifecycle_state = 'LIVE';

CREATE TABLE app.maintenance_windows (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  check_id uuid,
  group_id uuid,
  name varchar(160) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'SCHEDULED',
  cancelled_at timestamptz,
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT maintenance_windows_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT maintenance_windows_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_windows_group_fk FOREIGN KEY (owner_id, group_id)
    REFERENCES app.check_groups (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT maintenance_windows_one_target CHECK (num_nonnulls(check_id, group_id) = 1),
  CONSTRAINT maintenance_windows_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT maintenance_windows_range_valid CHECK (ends_at > starts_at),
  CONSTRAINT maintenance_windows_state_valid CHECK (state IN ('SCHEDULED', 'CANCELLED')),
  CONSTRAINT maintenance_windows_cancel_consistent CHECK ((state = 'CANCELLED') = (cancelled_at IS NOT NULL)),
  CONSTRAINT maintenance_windows_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE INDEX maintenance_check_active_idx
  ON app.maintenance_windows (owner_id, check_id, starts_at, ends_at)
  WHERE state = 'SCHEDULED' AND check_id IS NOT NULL;
CREATE INDEX maintenance_group_active_idx
  ON app.maintenance_windows (owner_id, group_id, starts_at, ends_at)
  WHERE state = 'SCHEDULED' AND group_id IS NOT NULL;
CREATE INDEX maintenance_ending_idx ON app.maintenance_windows (ends_at, id)
WHERE state = 'SCHEDULED';

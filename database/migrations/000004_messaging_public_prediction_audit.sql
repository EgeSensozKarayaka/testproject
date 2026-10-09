-- migrate:transaction true

CREATE TABLE infra.outbox_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid REFERENCES auth.users (id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  schema_version smallint NOT NULL CHECK (schema_version >= 1),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  aggregate_version bigint,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT outbox_events_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT outbox_events_names_not_blank CHECK (btrim(event_type) <> '' AND btrim(aggregate_type) <> ''),
  CONSTRAINT outbox_events_payload_object CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 32768),
  CONSTRAINT outbox_events_aggregate_version_valid CHECK (aggregate_version IS NULL OR aggregate_version >= 1)
);

CREATE INDEX outbox_events_owner_time_idx ON infra.outbox_events (owner_id, occurred_at DESC, id);

CREATE TABLE infra.outbox_dispatches (
  event_id uuid NOT NULL REFERENCES infra.outbox_events (id) ON DELETE RESTRICT,
  destination text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  last_error_code text,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (event_id, destination),
  CONSTRAINT outbox_dispatches_destination_valid CHECK (destination IN ('REALTIME', 'NOTIFICATION', 'PREDICTION', 'AUDIT')),
  CONSTRAINT outbox_dispatches_state_valid CHECK (state IN ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'COMPLETED', 'DEAD')),
  CONSTRAINT outbox_dispatches_lease_consistent CHECK (
    (state = 'PROCESSING' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR state <> 'PROCESSING'
  ),
  CONSTRAINT outbox_dispatches_terminal_consistent CHECK (
    (state IN ('COMPLETED', 'DEAD') AND completed_at IS NOT NULL)
    OR (state NOT IN ('COMPLETED', 'DEAD') AND completed_at IS NULL)
  )
);

CREATE INDEX outbox_dispatches_claim_idx
  ON infra.outbox_dispatches (available_at, event_id, destination)
  WHERE state IN ('PENDING', 'RETRY_WAIT');
CREATE INDEX outbox_dispatches_lease_idx ON infra.outbox_dispatches (lease_expires_at, event_id)
WHERE state = 'PROCESSING';

CREATE TABLE notification.recipients (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  email_normalized varchar(320) NOT NULL,
  email_display varchar(320) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_VERIFICATION',
  verified_at timestamptz,
  disabled_at timestamptz,
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT recipients_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT recipients_owner_email_unique UNIQUE (owner_id, email_normalized),
  CONSTRAINT recipients_status_valid CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'DISABLED')),
  CONSTRAINT recipients_status_times_consistent CHECK (
    (status = 'PENDING_VERIFICATION' AND verified_at IS NULL AND disabled_at IS NULL)
    OR (status = 'VERIFIED' AND verified_at IS NOT NULL AND disabled_at IS NULL)
    OR (status = 'DISABLED' AND disabled_at IS NOT NULL)
  ),
  CONSTRAINT recipients_email_not_blank CHECK (btrim(email_normalized) <> '' AND btrim(email_display) <> ''),
  CONSTRAINT recipients_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE TABLE notification.recipient_verification_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  token_digest bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT recipient_verification_tokens_recipient_fk FOREIGN KEY (owner_id, recipient_id)
    REFERENCES notification.recipients (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT recipient_verification_tokens_digest_unique UNIQUE (token_digest),
  CONSTRAINT recipient_verification_tokens_digest_length CHECK (octet_length(token_digest) = 32),
  CONSTRAINT recipient_verification_tokens_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT recipient_verification_tokens_consumed_valid CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX recipient_verification_tokens_open_idx
  ON notification.recipient_verification_tokens (owner_id, recipient_id, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE notification.policies (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  group_id uuid,
  mode text NOT NULL,
  notify_down boolean,
  notify_recovery boolean,
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notification_policies_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT notification_policies_group_fk FOREIGN KEY (owner_id, group_id)
    REFERENCES app.check_groups (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT notification_policies_scope_unique UNIQUE NULLS NOT DISTINCT (owner_id, group_id),
  CONSTRAINT notification_policies_mode_valid CHECK (mode IN ('ACTIVE', 'INHERIT', 'DISABLED')),
  CONSTRAINT notification_policies_default_not_inherit CHECK (group_id IS NOT NULL OR mode <> 'INHERIT'),
  CONSTRAINT notification_policies_flags_consistent CHECK (
    (mode = 'ACTIVE' AND notify_down IS NOT NULL AND notify_recovery IS NOT NULL)
    OR (mode IN ('INHERIT', 'DISABLED') AND notify_down IS NULL AND notify_recovery IS NULL)
  ),
  CONSTRAINT notification_policies_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE TABLE notification.policy_recipients (
  owner_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (policy_id, recipient_id),
  CONSTRAINT policy_recipients_policy_fk FOREIGN KEY (owner_id, policy_id)
    REFERENCES notification.policies (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT policy_recipients_recipient_fk FOREIGN KEY (owner_id, recipient_id)
    REFERENCES notification.recipients (owner_id, id) ON DELETE RESTRICT
);

CREATE TABLE notification.intents (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  source_event_id uuid NOT NULL,
  event_kind text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING_EVALUATION',
  maintenance_until timestamptz,
  policy_version_snapshot bigint,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  evaluated_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT notification_intents_incident_fk FOREIGN KEY (owner_id, check_id, incident_id)
    REFERENCES monitoring.incidents (owner_id, check_id, id) ON DELETE RESTRICT,
  CONSTRAINT notification_intents_event_fk FOREIGN KEY (owner_id, source_event_id)
    REFERENCES infra.outbox_events (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT notification_intents_lineage_unique UNIQUE (owner_id, incident_id, id),
  CONSTRAINT notification_intents_event_unique UNIQUE (source_event_id),
  CONSTRAINT notification_intents_transition_unique UNIQUE (incident_id, event_kind),
  CONSTRAINT notification_intents_kind_valid CHECK (event_kind IN ('INCIDENT_OPENED', 'INCIDENT_RECOVERED')),
  CONSTRAINT notification_intents_state_valid CHECK (
    state IN ('PENDING_EVALUATION', 'DEFERRED_MAINTENANCE', 'MATERIALIZED', 'CANCELLED', 'NO_RECIPIENTS')
  ),
  CONSTRAINT notification_intents_maintenance_consistent CHECK (
    (state = 'DEFERRED_MAINTENANCE' AND maintenance_until IS NOT NULL)
    OR state <> 'DEFERRED_MAINTENANCE'
  ),
  CONSTRAINT notification_intents_terminal_consistent CHECK (
    (state IN ('MATERIALIZED', 'CANCELLED', 'NO_RECIPIENTS') AND completed_at IS NOT NULL)
    OR (state NOT IN ('MATERIALIZED', 'CANCELLED', 'NO_RECIPIENTS') AND completed_at IS NULL)
  )
);

CREATE INDEX notification_intents_evaluation_idx
  ON notification.intents (maintenance_until, created_at, id)
  WHERE state IN ('PENDING_EVALUATION', 'DEFERRED_MAINTENANCE');

CREATE TABLE notification.deliveries (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  intent_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  incident_id uuid NOT NULL,
  event_kind text NOT NULL,
  recipient_address_snapshot varchar(320) NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  provider_message_id text,
  last_result_code text,
  last_error_detail varchar(1024),
  sent_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT notification_deliveries_intent_fk FOREIGN KEY (owner_id, incident_id, intent_id)
    REFERENCES notification.intents (owner_id, incident_id, id) ON DELETE RESTRICT,
  CONSTRAINT notification_deliveries_recipient_fk FOREIGN KEY (owner_id, recipient_id)
    REFERENCES notification.recipients (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT notification_deliveries_idempotency_unique UNIQUE (incident_id, event_kind, recipient_id),
  CONSTRAINT notification_deliveries_kind_valid CHECK (event_kind IN ('INCIDENT_OPENED', 'INCIDENT_RECOVERED')),
  CONSTRAINT notification_deliveries_state_valid CHECK (
    state IN ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED')
  ),
  CONSTRAINT notification_deliveries_attempts_valid CHECK (
    attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts
  ),
  CONSTRAINT notification_deliveries_lease_consistent CHECK (
    (state = 'PROCESSING' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR state <> 'PROCESSING'
  ),
  CONSTRAINT notification_deliveries_terminal_consistent CHECK (
    (state IN ('SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED') AND completed_at IS NOT NULL)
    OR (state NOT IN ('SENT', 'FAILED', 'DELIVERY_UNKNOWN', 'CANCELLED') AND completed_at IS NULL)
  ),
  CONSTRAINT notification_deliveries_sent_consistent CHECK ((state = 'SENT') = (sent_at IS NOT NULL)),
  CONSTRAINT notification_deliveries_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE INDEX notification_deliveries_claim_idx
  ON notification.deliveries (available_at, id)
  WHERE state IN ('PENDING', 'RETRY_WAIT');
CREATE INDEX notification_deliveries_lease_idx ON notification.deliveries (lease_expires_at, id)
WHERE state = 'PROCESSING';

CREATE TABLE public_status.pages (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  description varchar(2000),
  state text NOT NULL DEFAULT 'DRAFT',
  slug_digest bytea NOT NULL,
  token_revision bigint NOT NULL DEFAULT 1 CHECK (token_revision >= 1),
  resource_version bigint NOT NULL DEFAULT 1 CHECK (resource_version >= 1),
  published_at timestamptz,
  disabled_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT public_pages_owner_id_id_unique UNIQUE (owner_id, id),
  CONSTRAINT public_pages_slug_unique UNIQUE (slug_digest),
  CONSTRAINT public_pages_slug_length CHECK (octet_length(slug_digest) = 32),
  CONSTRAINT public_pages_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT public_pages_state_valid CHECK (state IN ('DRAFT', 'PUBLISHED', 'DISABLED')),
  CONSTRAINT public_pages_state_times_consistent CHECK (
    (state = 'DRAFT' AND published_at IS NULL AND disabled_at IS NULL)
    OR (state = 'PUBLISHED' AND published_at IS NOT NULL AND disabled_at IS NULL)
    OR (state = 'DISABLED' AND disabled_at IS NOT NULL)
  ),
  CONSTRAINT public_pages_timestamps_valid CHECK (updated_at >= created_at AND (deleted_at IS NULL OR deleted_at >= created_at))
);

CREATE TABLE public_status.components (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  page_id uuid NOT NULL,
  check_id uuid,
  group_id uuid,
  position integer NOT NULL CHECK (position >= 0),
  display_name varchar(160),
  show_url boolean NOT NULL DEFAULT false,
  show_response_time boolean NOT NULL DEFAULT true,
  show_incident_history boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT public_components_page_fk FOREIGN KEY (owner_id, page_id)
    REFERENCES public_status.pages (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_components_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_components_group_fk FOREIGN KEY (owner_id, group_id)
    REFERENCES app.check_groups (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_components_one_target CHECK (num_nonnulls(check_id, group_id) = 1),
  CONSTRAINT public_components_position_unique UNIQUE (page_id, position),
  CONSTRAINT public_components_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX public_components_check_unique ON public_status.components (page_id, check_id)
WHERE check_id IS NOT NULL;
CREATE UNIQUE INDEX public_components_group_unique ON public_status.components (page_id, group_id)
WHERE group_id IS NOT NULL;

CREATE TABLE public_status.snapshots (
  page_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  slug_digest bytea NOT NULL,
  page_revision bigint NOT NULL CHECK (page_revision >= 1),
  payload_schema_version smallint NOT NULL CHECK (payload_schema_version >= 1),
  payload jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT public_snapshots_page_fk FOREIGN KEY (owner_id, page_id)
    REFERENCES public_status.pages (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT public_snapshots_slug_unique UNIQUE (slug_digest),
  CONSTRAINT public_snapshots_slug_length CHECK (octet_length(slug_digest) = 32),
  CONSTRAINT public_snapshots_payload_object CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144)
);

CREATE TABLE prediction.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  requested_through timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'PENDING',
  available_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  completed_at timestamptz,
  CONSTRAINT analysis_jobs_check_fk FOREIGN KEY (owner_id, check_id)
    REFERENCES app.checks (owner_id, id) ON DELETE RESTRICT,
  CONSTRAINT analysis_jobs_owner_check_id_unique UNIQUE (owner_id, check_id, id),
  CONSTRAINT analysis_jobs_state_valid CHECK (state IN ('PENDING', 'PROCESSING', 'RETRY_WAIT', 'COMPLETED', 'DEAD')),
  CONSTRAINT analysis_jobs_attempts_valid CHECK (attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts),
  CONSTRAINT analysis_jobs_lease_consistent CHECK (
    (state = 'PROCESSING' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR state <> 'PROCESSING'
  ),
  CONSTRAINT analysis_jobs_terminal_consistent CHECK (
    (state IN ('COMPLETED', 'DEAD') AND completed_at IS NOT NULL)
    OR (state NOT IN ('COMPLETED', 'DEAD') AND completed_at IS NULL)
  ),
  CONSTRAINT analysis_jobs_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX analysis_jobs_one_active_idx ON prediction.analysis_jobs (owner_id, check_id)
WHERE state IN ('PENDING', 'PROCESSING', 'RETRY_WAIT');
CREATE INDEX analysis_jobs_claim_idx ON prediction.analysis_jobs (available_at, id)
WHERE state IN ('PENDING', 'RETRY_WAIT');

CREATE TABLE prediction.model_versions (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  name text NOT NULL,
  version text NOT NULL,
  artifact_digest text NOT NULL,
  feature_schema_version smallint NOT NULL CHECK (feature_schema_version >= 1),
  status text NOT NULL DEFAULT 'CANDIDATE',
  activated_at timestamptz,
  retired_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT model_versions_name_version_unique UNIQUE (name, version),
  CONSTRAINT model_versions_fields_not_blank CHECK (btrim(name) <> '' AND btrim(version) <> '' AND btrim(artifact_digest) <> ''),
  CONSTRAINT model_versions_status_valid CHECK (status IN ('CANDIDATE', 'ACTIVE', 'RETIRED')),
  CONSTRAINT model_versions_metadata_object CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 32768),
  CONSTRAINT model_versions_times_consistent CHECK (
    (status = 'CANDIDATE' AND activated_at IS NULL AND retired_at IS NULL)
    OR (status = 'ACTIVE' AND activated_at IS NOT NULL AND retired_at IS NULL)
    OR (status = 'RETIRED' AND activated_at IS NOT NULL AND retired_at IS NOT NULL)
  ),
  CONSTRAINT model_versions_timestamps_valid CHECK (updated_at >= created_at)
);

CREATE TABLE prediction.scores (
  computed_at timestamptz NOT NULL,
  id uuid NOT NULL DEFAULT uuidv7(),
  owner_id uuid NOT NULL,
  check_id uuid NOT NULL,
  analysis_job_id uuid NOT NULL,
  model_version_id uuid NOT NULL REFERENCES prediction.model_versions (id) ON DELETE RESTRICT,
  horizon_seconds integer NOT NULL CHECK (horizon_seconds > 0),
  risk_score numeric(6, 5) NOT NULL CHECK (risk_score BETWEEN 0 AND 1),
  risk_level text NOT NULL,
  valid_until timestamptz NOT NULL,
  feature_window_start timestamptz NOT NULL,
  feature_window_end timestamptz NOT NULL,
  feature_snapshot jsonb NOT NULL,
  reason_codes jsonb NOT NULL,
  PRIMARY KEY (owner_id, check_id, computed_at, id),
  CONSTRAINT prediction_scores_job_fk FOREIGN KEY (owner_id, check_id, analysis_job_id)
    REFERENCES prediction.analysis_jobs (owner_id, check_id, id) ON DELETE RESTRICT,
  CONSTRAINT prediction_scores_risk_level_valid CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'INSUFFICIENT_DATA')),
  CONSTRAINT prediction_scores_validity_valid CHECK (valid_until > computed_at),
  CONSTRAINT prediction_scores_window_valid CHECK (feature_window_end > feature_window_start AND feature_window_end <= computed_at),
  CONSTRAINT prediction_scores_feature_object CHECK (jsonb_typeof(feature_snapshot) = 'object' AND octet_length(feature_snapshot::text) <= 32768),
  CONSTRAINT prediction_scores_reasons_array CHECK (jsonb_typeof(reason_codes) = 'array' AND octet_length(reason_codes::text) <= 16384)
) PARTITION BY RANGE (computed_at);

CREATE INDEX prediction_scores_latest_idx ON prediction.scores (owner_id, check_id, computed_at DESC, id);

CREATE TABLE audit.events (
  occurred_at timestamptz NOT NULL,
  id uuid NOT NULL DEFAULT uuidv7(),
  owner_id uuid,
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  correlation_id uuid NOT NULL,
  result text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (occurred_at, id),
  CONSTRAINT audit_events_owner_fk FOREIGN KEY (owner_id) REFERENCES auth.users (id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_actor_valid CHECK (actor_type IN ('USER', 'WORKER', 'SYSTEM')),
  CONSTRAINT audit_events_result_valid CHECK (result IN ('SUCCESS', 'DENIED', 'FAILED')),
  CONSTRAINT audit_events_names_not_blank CHECK (btrim(action) <> '' AND btrim(resource_type) <> ''),
  CONSTRAINT audit_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX audit_events_owner_time_idx ON audit.events (owner_id, occurred_at DESC, id);

import type { ColumnType } from 'kysely';

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type GeneratedUuid = ColumnType<string, string | undefined, never>;
type BigIntValue = ColumnType<string, bigint | number | string, bigint | number | string>;
type GeneratedBigInt = ColumnType<
  string,
  bigint | number | string | undefined,
  bigint | number | string
>;
type JsonObject = ColumnType<
  Record<string, JsonValue>,
  Record<string, JsonValue> | string,
  Record<string, JsonValue> | string
>;
type JsonArray = ColumnType<JsonValue[], JsonValue[] | string, JsonValue[] | string>;

interface OwnedRow {
  owner_id: string;
}

interface CreatedUpdatedRow {
  created_at: GeneratedTimestamp;
  updated_at: GeneratedTimestamp;
}

export interface UserTable extends CreatedUpdatedRow {
  deletion_requested_at: Timestamp | null;
  display_name: string;
  email_display: string;
  email_normalized: string;
  email_verified_at: Timestamp | null;
  id: GeneratedUuid;
  resource_version: GeneratedBigInt;
  status: 'ACTIVE' | 'DELETION_REQUESTED' | 'DISABLED' | 'PENDING_VERIFICATION';
}

export interface PasswordCredentialTable extends OwnedRow {
  changed_at: GeneratedTimestamp;
  password_hash: string;
  password_version: number;
}

export interface SessionTable extends OwnedRow {
  absolute_expires_at: Timestamp;
  created_at: GeneratedTimestamp;
  expires_at: Timestamp;
  id: GeneratedUuid;
  idle_expires_at: Timestamp;
  issued_password_version: number;
  last_seen_at: Timestamp | null;
  revoke_reason: string | null;
  revoked_at: Timestamp | null;
  rotated_from_session_id: string | null;
  rotated_to_session_id: string | null;
  rotation_grace_expires_at: Timestamp | null;
  token_digest: Buffer;
  updated_at: GeneratedTimestamp;
}

export interface RateLimitCounterTable {
  bucket_seconds: number;
  bucket_start: Timestamp;
  expires_at: Timestamp;
  policy: string;
  request_count: number;
  scope_digest: Buffer;
}

export interface TransactionalEmailDeliveryTable extends OwnedRow {
  attempt_count: number;
  available_at: GeneratedTimestamp;
  completed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  encrypted_payload: Buffer;
  encryption_iv: Buffer;
  encryption_key_version: string;
  encryption_tag: Buffer;
  fencing_token: GeneratedBigInt;
  id: GeneratedUuid;
  last_result_code: string | null;
  lease_expires_at: Timestamp | null;
  lease_owner: string | null;
  max_attempts: number;
  provider_message_id: string | null;
  purpose: 'RESET_PASSWORD' | 'VERIFY_ACCOUNT_EMAIL';
  recipient_address_snapshot: string;
  state: 'DELIVERY_UNKNOWN' | 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY_WAIT' | 'SENT';
  updated_at: GeneratedTimestamp;
}

export interface OneTimeTokenTable extends OwnedRow {
  consumed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  expires_at: Timestamp;
  id: GeneratedUuid;
  purpose: 'RESET_PASSWORD' | 'VERIFY_ACCOUNT_EMAIL';
  token_digest: Buffer;
}

export interface CheckGroupTable extends CreatedUpdatedRow, OwnedRow {
  deleted_at: Timestamp | null;
  id: GeneratedUuid;
  name: string;
  resource_version: GeneratedBigInt;
}

export interface CheckTable extends CreatedUpdatedRow, OwnedRow {
  cadence_anchor_at: GeneratedTimestamp;
  deleted_at: Timestamp | null;
  execution_state: 'ACTIVE' | 'PAUSED';
  expected_body_substring: string | null;
  expected_status_code: number;
  group_id: string | null;
  id: GeneratedUuid;
  interval_seconds: number;
  lifecycle_state: 'DELETED' | 'LIVE';
  manual_requested_at: Timestamp | null;
  name: string;
  next_fencing_token: GeneratedBigInt;
  next_run_at: Timestamp | null;
  probe_generation: GeneratedBigInt;
  resource_version: GeneratedBigInt;
  schedule_generation: GeneratedBigInt;
  timeout_ms: number;
  url: string;
}

export interface MaintenanceWindowTable extends CreatedUpdatedRow, OwnedRow {
  cancelled_at: Timestamp | null;
  check_id: string | null;
  ends_at: Timestamp;
  group_id: string | null;
  id: GeneratedUuid;
  name: string;
  resource_version: GeneratedBigInt;
  starts_at: Timestamp;
  state: 'CANCELLED' | 'SCHEDULED';
}

export interface CheckJobTable extends CreatedUpdatedRow, OwnedRow {
  attempt_count: number;
  available_at: GeneratedTimestamp;
  check_id: string;
  completed_at: Timestamp | null;
  config_snapshot: JsonObject;
  fencing_token: BigIntValue | null;
  heartbeat_at: Timestamp | null;
  id: GeneratedUuid;
  lease_expires_at: Timestamp | null;
  lease_owner: string | null;
  manual_mode: 'DIAGNOSTIC' | 'STATEFUL' | null;
  max_attempts: number;
  priority: number;
  probe_generation: BigIntValue;
  resource_version: BigIntValue;
  schedule_generation: BigIntValue;
  scheduled_for: Timestamp;
  started_at: Timestamp | null;
  state: 'CANCELLED' | 'COMPLETED' | 'DEAD' | 'LEASED' | 'PENDING' | 'RUNNING';
  terminal_reason: string | null;
  trigger_kind: 'MANUAL' | 'SCHEDULED';
}

export interface CheckJobAttemptTable extends OwnedRow {
  attempt_number: number;
  check_id: string;
  ended_at: Timestamp | null;
  fencing_token: BigIntValue;
  id: GeneratedUuid;
  job_id: string;
  last_heartbeat_at: Timestamp | null;
  lease_acquired_at: Timestamp;
  result_recorded_at: Timestamp | null;
  started_at: Timestamp;
  terminal_reason: 'CANCELLED' | 'INTERNAL_ERROR' | 'LEASE_LOST' | 'RESULT_RECORDED' | null;
  worker_id: string;
}

export interface CheckRunTable extends OwnedRow {
  accepted_for_state: boolean;
  attempt_id: string;
  body_match: boolean | null;
  check_id: string;
  connect_ms: number | null;
  diagnostic: string | null;
  dns_ms: number | null;
  failure_category: string | null;
  fencing_token: BigIntValue;
  finished_at: Timestamp;
  id: GeneratedUuid;
  job_id: string;
  manual_mode: 'DIAGNOSTIC' | 'STATEFUL' | null;
  outcome: 'FAIL' | 'PASS';
  probe_generation: BigIntValue;
  recorded_at: GeneratedTimestamp;
  rejection_reason: string | null;
  resource_version: BigIntValue;
  schedule_generation: BigIntValue;
  scheduled_for: Timestamp;
  started_at: Timestamp;
  status_code: number | null;
  tls_ms: number | null;
  total_ms: number;
  trigger_kind: 'MANUAL' | 'SCHEDULED';
  ttfb_ms: number | null;
}

export interface IncidentTable extends CreatedUpdatedRow, OwnedRow {
  check_id: string;
  closed_at: Timestamp | null;
  closure_reason: 'ADMINISTRATIVE' | 'CHECK_DELETED' | 'CONFIG_CHANGED' | 'RECOVERED' | null;
  confirmation_run_finished_at: Timestamp;
  confirmation_run_id: string;
  confirmed_at: Timestamp;
  first_failure_run_finished_at: Timestamp;
  first_failure_run_id: string;
  id: GeneratedUuid;
  last_failure_category: string | null;
  observation_mode: 'OBSERVED' | 'UNOBSERVED';
  observed_duration_ms: GeneratedBigInt;
  resource_version: GeneratedBigInt;
  started_at: Timestamp;
  status: 'CLOSED' | 'OPEN';
}

export interface IncidentSegmentTable extends CreatedUpdatedRow, OwnedRow {
  check_id: string;
  close_reason: 'CONFIG_CHANGED' | 'DELETED' | 'PAUSED' | 'RECOVERED' | 'STALE' | null;
  end_run_finished_at: Timestamp | null;
  end_run_id: string | null;
  ended_at: Timestamp | null;
  id: GeneratedUuid;
  incident_id: string;
  start_run_finished_at: Timestamp;
  start_run_id: string;
  started_at: Timestamp;
}

export interface CheckCurrentStateTable extends OwnedRow {
  candidate_run_finished_at: Timestamp | null;
  candidate_run_id: string | null;
  candidate_started_at: Timestamp | null;
  check_id: string;
  consecutive_failure_count: number;
  fresh_until: Timestamp | null;
  freshness_state: 'FRESH' | 'STALE';
  health_state: 'DOWN' | 'SUSPECT' | 'UNKNOWN' | 'UP';
  last_accepted_fencing_token: GeneratedBigInt;
  last_accepted_run_finished_at: Timestamp | null;
  last_accepted_run_id: string | null;
  last_failure_at: Timestamp | null;
  last_failure_category: string | null;
  last_response_time_ms: number | null;
  last_status_code: number | null;
  last_success_at: Timestamp | null;
  open_incident_id: string | null;
  stale_reconciled_at: Timestamp | null;
  state_version: GeneratedBigInt;
  updated_at: GeneratedTimestamp;
}

export interface OpenHealthIntervalTable extends OwnedRow {
  check_id: string;
  classification: 'DOWN' | 'PROVISIONAL' | 'UNKNOWN' | 'UP';
  id: GeneratedUuid;
  probe_generation: BigIntValue;
  source_kind: 'CONFIG' | 'FRESHNESS' | 'PAUSE' | 'RESUME' | 'RUN' | 'STARTUP';
  source_run_finished_at: Timestamp | null;
  source_run_id: string | null;
  started_at: Timestamp;
  updated_at: GeneratedTimestamp;
}

export interface HealthIntervalTable extends OwnedRow {
  check_id: string;
  classification: 'DOWN' | 'UNKNOWN' | 'UP';
  ended_at: Timestamp;
  finalized_at: GeneratedTimestamp;
  id: string;
  probe_generation: BigIntValue;
  source_kind: 'CONFIG' | 'FRESHNESS' | 'PAUSE' | 'RESUME' | 'RUN' | 'STARTUP';
  source_run_finished_at: Timestamp | null;
  source_run_id: string | null;
  started_at: Timestamp;
}

export interface RollupTable extends OwnedRow {
  accepted_run_count: number;
  bucket_start: Timestamp;
  check_id: string;
  computed_through: Timestamp;
  down_ms: BigIntValue;
  fail_count: number;
  pass_count: number;
  probe_generation: BigIntValue;
  provisional_ms: BigIntValue;
  response_max_ms: number | null;
  response_min_ms: number | null;
  response_sample_count: number;
  response_sum_ms: BigIntValue;
  revision: GeneratedBigInt;
  unknown_ms: BigIntValue;
  up_ms: BigIntValue;
  updated_at: GeneratedTimestamp;
}

export interface RollupCheckpointTable {
  last_error_code: string | null;
  last_partition: string | null;
  processor_name: string;
  updated_at: GeneratedTimestamp;
  watermark_at: Timestamp;
}

export interface OutboxEventTable {
  aggregate_id: string;
  aggregate_type: string;
  aggregate_version: BigIntValue | null;
  causation_id: string | null;
  correlation_id: string;
  created_at: GeneratedTimestamp;
  event_type: string;
  id: GeneratedUuid;
  occurred_at: Timestamp;
  owner_id: string | null;
  payload: JsonObject;
  schema_version: number;
}

export interface OutboxDispatchTable {
  attempt_count: number;
  available_at: GeneratedTimestamp;
  completed_at: Timestamp | null;
  destination: 'AUDIT' | 'NOTIFICATION' | 'PREDICTION' | 'REALTIME';
  event_id: string;
  fencing_token: GeneratedBigInt;
  last_error_code: string | null;
  lease_expires_at: Timestamp | null;
  lease_owner: string | null;
  state: 'COMPLETED' | 'DEAD' | 'PENDING' | 'PROCESSING' | 'RETRY_WAIT';
  updated_at: GeneratedTimestamp;
}

export interface ApiIdempotencyRecordTable {
  created_at: GeneratedTimestamp;
  encrypted_response: Buffer | null;
  encryption_key_version: string | null;
  expires_at: Timestamp;
  id: GeneratedUuid;
  key_digest: Buffer;
  operation: string;
  owner_id: string | null;
  request_hash: Buffer;
  response_body: JsonObject | null;
  response_headers: JsonObject;
  response_status: number;
  subject_digest: Buffer;
}

export interface RecipientTable extends CreatedUpdatedRow, OwnedRow {
  disabled_at: Timestamp | null;
  email_display: string;
  email_normalized: string;
  id: GeneratedUuid;
  resource_version: GeneratedBigInt;
  status: 'DISABLED' | 'PENDING_VERIFICATION' | 'VERIFIED';
  verified_at: Timestamp | null;
}

export interface RecipientVerificationTokenTable extends OwnedRow {
  consumed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  expires_at: Timestamp;
  id: GeneratedUuid;
  recipient_id: string;
  token_digest: Buffer;
}

export interface NotificationPolicyTable extends CreatedUpdatedRow, OwnedRow {
  group_id: string | null;
  id: GeneratedUuid;
  mode: 'ACTIVE' | 'DISABLED' | 'INHERIT';
  notify_down: boolean | null;
  notify_recovery: boolean | null;
  resource_version: GeneratedBigInt;
}

export interface PolicyRecipientTable extends OwnedRow {
  created_at: GeneratedTimestamp;
  policy_id: string;
  recipient_id: string;
}

export interface NotificationIntentTable extends OwnedRow {
  check_id: string;
  completed_at: Timestamp | null;
  created_at: GeneratedTimestamp;
  evaluated_at: Timestamp | null;
  event_kind: 'INCIDENT_OPENED' | 'INCIDENT_RECOVERED';
  id: GeneratedUuid;
  incident_id: string;
  maintenance_until: Timestamp | null;
  policy_version_snapshot: BigIntValue | null;
  source_event_id: string;
  state:
    'CANCELLED' | 'DEFERRED_MAINTENANCE' | 'MATERIALIZED' | 'NO_RECIPIENTS' | 'PENDING_EVALUATION';
}

export interface NotificationDeliveryTable extends CreatedUpdatedRow, OwnedRow {
  attempt_count: number;
  available_at: GeneratedTimestamp;
  completed_at: Timestamp | null;
  event_kind: 'INCIDENT_OPENED' | 'INCIDENT_RECOVERED';
  fencing_token: GeneratedBigInt;
  id: GeneratedUuid;
  incident_id: string;
  intent_id: string;
  last_error_detail: string | null;
  last_result_code: string | null;
  lease_expires_at: Timestamp | null;
  lease_owner: string | null;
  max_attempts: number;
  next_attempt_at: Timestamp | null;
  provider_message_id: string | null;
  recipient_address_snapshot: string;
  recipient_id: string;
  sent_at: Timestamp | null;
  state:
    'CANCELLED' | 'DELIVERY_UNKNOWN' | 'FAILED' | 'PENDING' | 'PROCESSING' | 'RETRY_WAIT' | 'SENT';
}

export interface PublicPageTable extends CreatedUpdatedRow, OwnedRow {
  deleted_at: Timestamp | null;
  description: string | null;
  disabled_at: Timestamp | null;
  id: GeneratedUuid;
  published_at: Timestamp | null;
  resource_version: GeneratedBigInt;
  slug_digest: Buffer;
  state: 'DISABLED' | 'DRAFT' | 'PUBLISHED';
  title: string;
  token_revision: GeneratedBigInt;
}

export interface PublicComponentTable extends CreatedUpdatedRow, OwnedRow {
  check_id: string | null;
  display_name: string | null;
  group_id: string | null;
  id: GeneratedUuid;
  page_id: string;
  position: number;
  show_incident_history: boolean;
  show_response_time: boolean;
  show_url: boolean;
}

export interface PublicSnapshotTable extends OwnedRow {
  generated_at: GeneratedTimestamp;
  page_id: string;
  page_revision: BigIntValue;
  payload: JsonObject;
  payload_schema_version: number;
  slug_digest: Buffer;
}

export interface AnalysisJobTable extends CreatedUpdatedRow, OwnedRow {
  attempt_count: number;
  available_at: GeneratedTimestamp;
  check_id: string;
  completed_at: Timestamp | null;
  fencing_token: GeneratedBigInt;
  id: GeneratedUuid;
  lease_expires_at: Timestamp | null;
  lease_owner: string | null;
  max_attempts: number;
  requested_through: Timestamp;
  state: 'COMPLETED' | 'DEAD' | 'PENDING' | 'PROCESSING' | 'RETRY_WAIT';
}

export interface ModelVersionTable extends CreatedUpdatedRow {
  activated_at: Timestamp | null;
  artifact_digest: string;
  feature_schema_version: number;
  id: GeneratedUuid;
  metadata: JsonObject;
  name: string;
  retired_at: Timestamp | null;
  status: 'ACTIVE' | 'CANDIDATE' | 'RETIRED';
  version: string;
}

export interface PredictionScoreTable extends OwnedRow {
  analysis_job_id: string;
  check_id: string;
  computed_at: Timestamp;
  feature_snapshot: JsonObject;
  feature_window_end: Timestamp;
  feature_window_start: Timestamp;
  horizon_seconds: number;
  id: GeneratedUuid;
  model_version_id: string;
  reason_codes: JsonArray;
  risk_level: 'HIGH' | 'INSUFFICIENT_DATA' | 'LOW' | 'MEDIUM';
  risk_score: string;
  valid_until: Timestamp;
}

export interface AuditEventTable {
  action: string;
  actor_id: string | null;
  actor_type: 'SYSTEM' | 'USER' | 'WORKER';
  correlation_id: string;
  id: GeneratedUuid;
  metadata: JsonObject;
  occurred_at: Timestamp;
  owner_id: string | null;
  recorded_at: GeneratedTimestamp;
  resource_id: string | null;
  resource_type: string;
  result: 'DENIED' | 'FAILED' | 'SUCCESS';
}

export interface DatabaseSchema {
  'app.check_groups': CheckGroupTable;
  'app.checks': CheckTable;
  'app.maintenance_windows': MaintenanceWindowTable;
  'audit.events': AuditEventTable;
  'auth.one_time_tokens': OneTimeTokenTable;
  'auth.password_credentials': PasswordCredentialTable;
  'auth.sessions': SessionTable;
  'auth.users': UserTable;
  'auth.rate_limit_counters': RateLimitCounterTable;
  'infra.outbox_dispatches': OutboxDispatchTable;
  'infra.outbox_events': OutboxEventTable;
  'infra.api_idempotency_records': ApiIdempotencyRecordTable;
  'monitoring.check_current_states': CheckCurrentStateTable;
  'monitoring.check_job_attempts': CheckJobAttemptTable;
  'monitoring.check_jobs': CheckJobTable;
  'monitoring.check_runs': CheckRunTable;
  'monitoring.health_intervals': HealthIntervalTable;
  'monitoring.incident_segments': IncidentSegmentTable;
  'monitoring.incidents': IncidentTable;
  'monitoring.open_health_intervals': OpenHealthIntervalTable;
  'monitoring.rollup_checkpoints': RollupCheckpointTable;
  'monitoring.rollups_hour': RollupTable;
  'monitoring.rollups_minute': RollupTable;
  'notification.deliveries': NotificationDeliveryTable;
  'notification.transactional_email_deliveries': TransactionalEmailDeliveryTable;
  'notification.intents': NotificationIntentTable;
  'notification.policies': NotificationPolicyTable;
  'notification.policy_recipients': PolicyRecipientTable;
  'notification.recipient_verification_tokens': RecipientVerificationTokenTable;
  'notification.recipients': RecipientTable;
  'prediction.analysis_jobs': AnalysisJobTable;
  'prediction.model_versions': ModelVersionTable;
  'prediction.scores': PredictionScoreTable;
  'public_status.components': PublicComponentTable;
  'public_status.pages': PublicPageTable;
  'public_status.snapshots': PublicSnapshotTable;
}

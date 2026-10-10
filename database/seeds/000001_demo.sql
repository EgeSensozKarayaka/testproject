INSERT INTO auth.users (
  id,
  email_normalized,
  email_display,
  display_name,
  status,
  email_verified_at
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'demo@example.test',
  'demo@example.test',
  'Demo User',
  'ACTIVE',
  statement_timestamp()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.check_groups (id, owner_id, name)
VALUES (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'Demo Services'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.checks (
  id,
  owner_id,
  group_id,
  name,
  url,
  interval_seconds,
  timeout_ms,
  expected_status_code,
  cadence_anchor_at,
  next_run_at
)
VALUES (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000101',
  'Target Simulator',
  'http://target-simulator:4010/ok',
  30,
  5000,
  200,
  statement_timestamp(),
  statement_timestamp()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO monitoring.check_current_states (check_id, owner_id)
VALUES (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (check_id) DO NOTHING;

INSERT INTO monitoring.open_health_intervals (
  check_id,
  owner_id,
  id,
  classification,
  started_at,
  probe_generation,
  source_kind
)
VALUES (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000202',
  'UNKNOWN',
  statement_timestamp(),
  1,
  'STARTUP'
)
ON CONFLICT (check_id) DO NOTHING;

INSERT INTO notification.recipients (
  id,
  owner_id,
  email_normalized,
  email_display,
  status,
  verified_at
)
VALUES (
  '00000000-0000-4000-8000-000000000301',
  '00000000-0000-4000-8000-000000000001',
  'demo@example.test',
  'demo@example.test',
  'VERIFIED',
  statement_timestamp()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO notification.policies (
  owner_id,
  group_id,
  mode,
  notify_down,
  notify_recovery
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  NULL,
  'ACTIVE',
  true,
  true
)
ON CONFLICT (owner_id, group_id) DO UPDATE SET
  mode = EXCLUDED.mode,
  notify_down = EXCLUDED.notify_down,
  notify_recovery = EXCLUDED.notify_recovery,
  resource_version = notification.policies.resource_version + 1,
  updated_at = statement_timestamp();

INSERT INTO notification.policy_recipients (owner_id, policy_id, recipient_id)
SELECT
  policy.owner_id,
  policy.id,
  '00000000-0000-4000-8000-000000000301'::uuid
FROM notification.policies AS policy
WHERE policy.owner_id = '00000000-0000-4000-8000-000000000001'
  AND policy.group_id IS NULL
ON CONFLICT (policy_id, recipient_id) DO NOTHING;

INSERT INTO public_status.pages (
  id,
  owner_id,
  title,
  description,
  state,
  slug_digest
)
VALUES (
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000001',
  'Demo Status',
  'Local development status page draft',
  'DRAFT',
  decode(repeat('22', 32), 'hex')
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public_status.components (
  id,
  owner_id,
  page_id,
  check_id,
  position,
  display_name,
  show_url,
  show_response_time,
  show_incident_history
)
VALUES (
  '00000000-0000-4000-8000-000000000601',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000501',
  '00000000-0000-4000-8000-000000000201',
  0,
  'Demo Service',
  false,
  true,
  true
)
ON CONFLICT (id) DO NOTHING;

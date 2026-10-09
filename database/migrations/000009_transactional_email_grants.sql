-- migrate:transaction true

GRANT USAGE ON SCHEMA security_api TO site_monitor_notifier;

COMMENT ON FUNCTION security_api.claim_transactional_email(text, integer) IS
  'Notifier-only fenced claim boundary for encrypted account email jobs.';
COMMENT ON FUNCTION security_api.complete_transactional_email(uuid, text, bigint, text, text, text, integer) IS
  'Notifier-only fenced completion boundary for encrypted account email jobs.';

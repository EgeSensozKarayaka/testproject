-- migrate:transaction true

DO $bootstrap_roles$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY[
    'site_monitor_schema_owner',
    'site_monitor_migrator',
    'site_monitor_api',
    'site_monitor_monitor',
    'site_monitor_notifier',
    'site_monitor_predictor',
    'site_monitor_public',
    'site_monitor_housekeeper'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
        role_name
      );
    END IF;
  END LOOP;

  IF current_user <> 'site_monitor_schema_owner' THEN
    EXECUTE format('GRANT site_monitor_schema_owner TO %I', current_user);
  END IF;
END
$bootstrap_roles$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS monitoring;
CREATE SCHEMA IF NOT EXISTS notification;
CREATE SCHEMA IF NOT EXISTS public_status;
CREATE SCHEMA IF NOT EXISTS prediction;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS security_api;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER SCHEMA infra OWNER TO site_monitor_schema_owner;
ALTER TABLE infra.schema_migrations OWNER TO site_monitor_schema_owner;
ALTER SCHEMA auth OWNER TO site_monitor_schema_owner;
ALTER SCHEMA app OWNER TO site_monitor_schema_owner;
ALTER SCHEMA monitoring OWNER TO site_monitor_schema_owner;
ALTER SCHEMA notification OWNER TO site_monitor_schema_owner;
ALTER SCHEMA public_status OWNER TO site_monitor_schema_owner;
ALTER SCHEMA prediction OWNER TO site_monitor_schema_owner;
ALTER SCHEMA audit OWNER TO site_monitor_schema_owner;
ALTER SCHEMA security_api OWNER TO site_monitor_schema_owner;

SET LOCAL ROLE site_monitor_schema_owner;
REVOKE ALL ON SCHEMA auth, app, monitoring, notification, public_status, prediction, audit, security_api, infra FROM PUBLIC;

CREATE TABLE infra.schema_compatibility (
  singleton_id boolean PRIMARY KEY DEFAULT true CHECK (singleton_id),
  current_revision bigint NOT NULL DEFAULT 0 CHECK (current_revision >= 0),
  compatibility_epoch bigint NOT NULL DEFAULT 1 CHECK (compatibility_epoch >= 1),
  minimum_app_epoch bigint NOT NULL DEFAULT 1 CHECK (minimum_app_epoch >= 1),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

INSERT INTO infra.schema_compatibility (singleton_id)
VALUES (true)
ON CONFLICT (singleton_id) DO NOTHING;

REVOKE ALL ON ALL TABLES IN SCHEMA infra FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA auth REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA app REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA monitoring REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA notification REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA public_status REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA prediction REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA audit REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA security_api REVOKE ALL ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA infra REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE site_monitor_schema_owner IN SCHEMA infra REVOKE ALL ON FUNCTIONS FROM PUBLIC;

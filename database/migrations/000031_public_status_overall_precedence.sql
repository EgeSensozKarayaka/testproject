-- migrate:transaction true

-- Derive overall health from the final allowlisted component array so ordering
-- cannot affect precedence: DOWN > SUSPECT > UNKNOWN > UP.
ALTER FUNCTION security_api.read_public_snapshot(bytea)
  RENAME TO read_public_snapshot_v2;

REVOKE ALL ON FUNCTION security_api.read_public_snapshot_v2(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.read_public_snapshot_v2(bytea) FROM site_monitor_public;

CREATE FUNCTION security_api.read_public_snapshot(p_slug_digest bytea)
RETURNS TABLE (
  payload jsonb,
  payload_schema_version smallint,
  generated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    jsonb_set(
      source_row.payload,
      '{overall_health_state}',
      to_jsonb(CASE
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(source_row.payload -> 'components') AS component(value)
          WHERE component.value ->> 'health_state' = 'DOWN'
        ) THEN 'DOWN'
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(source_row.payload -> 'components') AS component(value)
          WHERE component.value ->> 'health_state' = 'SUSPECT'
        ) THEN 'SUSPECT'
        WHEN EXISTS (
          SELECT 1 FROM jsonb_array_elements(source_row.payload -> 'components') AS component(value)
          WHERE component.value ->> 'health_state' = 'UNKNOWN'
        ) THEN 'UNKNOWN'
        WHEN jsonb_array_length(source_row.payload -> 'components') > 0 THEN 'UP'
        ELSE 'UNKNOWN'
      END)
    ),
    source_row.payload_schema_version,
    source_row.generated_at
  FROM security_api.read_public_snapshot_v2(p_slug_digest) AS source_row
$function$;

REVOKE ALL ON FUNCTION security_api.read_public_snapshot(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.read_public_snapshot(bytea) TO site_monitor_public;

-- migrate:transaction true

-- Revision 29 intentionally strips publication fields that are not allowed.
-- `last_checked_at`, however, is a required public contract field whose null
-- value means "not observed yet". Preserve that distinction without exposing
-- any optional field.
ALTER FUNCTION security_api.read_public_snapshot(bytea)
  RENAME TO read_public_snapshot_v1;

REVOKE ALL ON FUNCTION security_api.read_public_snapshot_v1(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.read_public_snapshot_v1(bytea) FROM site_monitor_public;

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
      '{components}',
      COALESCE((
        SELECT jsonb_agg(
          component_row.value
          || jsonb_build_object(
            'last_checked_at',
            COALESCE(component_row.value -> 'last_checked_at', 'null'::jsonb)
          )
          ORDER BY component_row.ordinality
        )
        FROM jsonb_array_elements(source_row.payload -> 'components')
          WITH ORDINALITY AS component_row(value, ordinality)
      ), '[]'::jsonb)
    ),
    source_row.payload_schema_version,
    source_row.generated_at
  FROM security_api.read_public_snapshot_v1(p_slug_digest) AS source_row
$function$;

REVOKE ALL ON FUNCTION security_api.read_public_snapshot(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.read_public_snapshot(bytea) TO site_monitor_public;

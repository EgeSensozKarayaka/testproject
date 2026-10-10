-- migrate:transaction true

-- The public contract calls an incident boundary `ended_at`, while the
-- incident aggregate persists it as `closed_at`. Revision 32 corrected the
-- current-state mapping; update that private projection implementation without
-- disturbing the public wrappers or their grants.
DO $migration$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef(
    'security_api.read_public_snapshot_v1(bytea)'::regprocedure
  ) INTO v_definition;

  v_definition := replace(v_definition, 'incident.ended_at', 'incident.closed_at');
  EXECUTE v_definition;
END
$migration$;

COMMENT ON FUNCTION security_api.read_public_snapshot_v1(bytea) IS
  'Builds the private live projection with physical state and incident fields mapped to their public contract names.';

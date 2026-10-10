-- migrate:transaction true

-- Retention must never outrun source discovery or a pending projection repair.
-- Keep the Revision 22 implementation immutable and place a fail-closed gate
-- in front of it. Row purge is intentionally deferred with partition DDL: a
-- short delay is safer than deleting lineage while history is still catching
-- up after an outage.
ALTER FUNCTION security_api.housekeeping_retention_step(integer)
  RENAME TO housekeeping_retention_step_unsafe;

REVOKE ALL ON FUNCTION security_api.housekeeping_retention_step_unsafe(integer)
  FROM PUBLIC, site_monitor_housekeeper;

CREATE FUNCTION security_api.housekeeping_retention_step(p_batch_size integer)
RETURNS TABLE (action text, purged_rows integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_projection_safe boolean;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 5000' USING ERRCODE = '22023';
  END IF;

  SELECT
    count(*) = 2
    AND bool_and(checkpoint.watermark_at >= statement_timestamp() - interval '5 minutes')
    AND NOT EXISTS (
      SELECT 1
      FROM monitoring.rollup_rebuild_ranges AS range_row
      WHERE range_row.state = 'PENDING'
    )
  INTO v_projection_safe
  FROM monitoring.rollup_checkpoints AS checkpoint
  WHERE checkpoint.processor_name IN ('runs-minute-source', 'intervals-minute-source');

  IF NOT coalesce(v_projection_safe, false) THEN
    RETURN QUERY SELECT 'DEFERRED_PROJECTION_BACKLOG'::text, 0;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT result.action, result.purged_rows
  FROM security_api.housekeeping_retention_step_unsafe(p_batch_size) AS result;
END
$function$;

REVOKE ALL ON FUNCTION security_api.housekeeping_retention_step(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_retention_step(integer)
  TO site_monitor_housekeeper;

COMMENT ON FUNCTION security_api.housekeeping_retention_step(integer) IS
  'Fails closed while source cursors lag or rebuild ranges remain pending, then delegates one bounded retention/purge step.';

-- migrate:transaction true

-- A source cursor identifies the last row, not how far an empty scan proved
-- the source was caught up. Preserve the exact tuple cursor and record a
-- separate scan horizon only when a source returned fewer than the batch
-- limit. Quiet/paused systems can then become retention-safe without
-- inventing a source row or moving the row cursor past unseen work.
ALTER FUNCTION security_api.housekeeping_discover_sources(integer)
  RENAME TO housekeeping_discover_sources_without_horizon;

REVOKE ALL ON FUNCTION security_api.housekeeping_discover_sources_without_horizon(integer)
  FROM PUBLIC, site_monitor_housekeeper;

CREATE FUNCTION security_api.housekeeping_discover_sources(p_batch_size integer)
RETURNS TABLE (run_sources integer, interval_sources integer, ranges_enqueued integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_result record;
  v_scan_horizon timestamptz := statement_timestamp();
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 5000' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_result
  FROM security_api.housekeeping_discover_sources_without_horizon(p_batch_size);

  IF v_result.run_sources < p_batch_size THEN
    UPDATE monitoring.rollup_checkpoints
    SET data_through = greatest(coalesce(data_through, '-infinity'::timestamptz), v_scan_horizon),
        updated_at = statement_timestamp(),
        revision = revision + 1
    WHERE processor_name = 'runs-minute-source';
  END IF;

  IF v_result.interval_sources < p_batch_size THEN
    UPDATE monitoring.rollup_checkpoints
    SET data_through = greatest(coalesce(data_through, '-infinity'::timestamptz), v_scan_horizon),
        updated_at = statement_timestamp(),
        revision = revision + 1
    WHERE processor_name = 'intervals-minute-source';
  END IF;

  RETURN QUERY
  SELECT v_result.run_sources::integer,
         v_result.interval_sources::integer,
         v_result.ranges_enqueued::integer;
END
$function$;

REVOKE ALL ON FUNCTION security_api.housekeeping_discover_sources(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_discover_sources(integer)
  TO site_monitor_housekeeper;

CREATE OR REPLACE FUNCTION security_api.housekeeping_retention_step(p_batch_size integer)
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
    AND bool_and(checkpoint.data_through >= statement_timestamp() - interval '5 minutes')
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

COMMENT ON FUNCTION security_api.housekeeping_discover_sources(integer) IS
  'Advances exact source cursors and records an independent caught-up scan horizon for quiet systems.';
COMMENT ON FUNCTION security_api.housekeeping_retention_step(integer) IS
  'Fails closed until both source scan horizons are current and no rebuild range remains pending.';

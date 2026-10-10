-- migrate:transaction true

-- Different source fingerprints can legitimately enqueue overlapping ranges.
-- Row-level SKIP LOCKED prevents duplicate ownership of one range but does not
-- prevent two replicas from rebuilding the same bucket through two different
-- ranges. Keep minute and hour lanes independent while serializing each lane;
-- every call still processes a configurable batch, so this lock is held for a
-- bounded transaction only.
ALTER FUNCTION security_api.housekeeping_process_rollup_range(text, integer)
  RENAME TO housekeeping_process_rollup_range_unlocked;

REVOKE ALL ON FUNCTION security_api.housekeeping_process_rollup_range_unlocked(text, integer)
  FROM PUBLIC, site_monitor_housekeeper;

CREATE FUNCTION security_api.housekeeping_process_rollup_range(
  p_resolution text,
  p_bucket_limit integer
)
RETURNS TABLE (range_id uuid, buckets_processed integer, range_completed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF p_resolution NOT IN ('MINUTE', 'HOUR') THEN
    RAISE EXCEPTION 'resolution must be MINUTE or HOUR' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('site-monitor:rollup-lane:' || p_resolution, 0)
  );

  RETURN QUERY
  SELECT result.range_id, result.buckets_processed, result.range_completed
  FROM security_api.housekeeping_process_rollup_range_unlocked(
    p_resolution,
    p_bucket_limit
  ) AS result;
END
$function$;

REVOKE ALL ON FUNCTION security_api.housekeeping_process_rollup_range(text, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_process_rollup_range(text, integer)
  TO site_monitor_housekeeper;

COMMENT ON FUNCTION security_api.housekeeping_process_rollup_range(text, integer) IS
  'Serializes one bounded resolution lane across replicas before invoking the SKIP LOCKED range processor.';

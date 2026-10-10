-- migrate:transaction true

CREATE FUNCTION security_api.history_projection_status(
  p_check_id uuid,
  p_resolution text,
  p_from timestamptz,
  p_to timestamptz
)
RETURNS TABLE (source_data_through timestamptz, pending_from timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_owner_id uuid := security_api.current_owner_id();
BEGIN
  IF p_resolution NOT IN ('minute', 'hour') THEN
    RAISE EXCEPTION 'resolution must be minute or hour' USING ERRCODE = '22023';
  END IF;
  IF p_to <= p_from THEN
    RAISE EXCEPTION 'history range must have positive duration' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM app.checks AS check_row
    WHERE check_row.owner_id = v_owner_id
      AND check_row.id = p_check_id
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN count(*) FILTER (
        WHERE checkpoint.processor_name IN ('runs-minute-source', 'intervals-minute-source')
          AND checkpoint.data_through IS NOT NULL
      ) = 2
      THEN min(checkpoint.data_through) FILTER (
        WHERE checkpoint.processor_name IN ('runs-minute-source', 'intervals-minute-source')
      )
      ELSE NULL
    END AS source_data_through,
    (
      SELECT min(greatest(range_row.next_bucket_start, p_from))
      FROM monitoring.rollup_rebuild_ranges AS range_row
      WHERE range_row.owner_id = v_owner_id
        AND range_row.check_id = p_check_id
        AND range_row.state IN ('PENDING', 'FAILED')
        AND range_row.range_start < p_to
        AND range_row.range_end > p_from
        AND (
          range_row.resolution = 'MINUTE'
          OR (p_resolution = 'hour' AND range_row.resolution = 'HOUR')
        )
    ) AS pending_from
  FROM monitoring.rollup_checkpoints AS checkpoint
  WHERE checkpoint.processor_name IN ('runs-minute-source', 'intervals-minute-source');
END
$function$;

REVOKE ALL ON FUNCTION security_api.history_projection_status(
  uuid, text, timestamptz, timestamptz
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.history_projection_status(
  uuid, text, timestamptz, timestamptz
) TO site_monitor_api;

COMMENT ON FUNCTION security_api.history_projection_status(
  uuid, text, timestamptz, timestamptz
) IS
  'Returns bounded history source and owner-scoped rebuild lag without exposing the housekeeping queue.';

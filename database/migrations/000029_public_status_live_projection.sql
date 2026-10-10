-- migrate:transaction true

-- Public reads remain behind a single SECURITY DEFINER boundary. The function
-- resolves only a published token digest and builds an allowlisted projection
-- from the component publication flags; private identifiers and notes are never
-- returned.
CREATE OR REPLACE FUNCTION security_api.read_public_snapshot(p_slug_digest bytea)
RETURNS TABLE (
  payload jsonb,
  payload_schema_version smallint,
  generated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_page public_status.pages%ROWTYPE;
  v_component record;
  v_now timestamptz := statement_timestamp();
  v_components jsonb := '[]'::jsonb;
  v_health text;
  v_overall text := 'UNKNOWN';
  v_name text;
  v_url text;
  v_response_time integer;
  v_last_checked timestamptz;
  v_maintenance boolean;
  v_incidents jsonb;
BEGIN
  SELECT page_row.*
  INTO v_page
  FROM public_status.pages AS page_row
  WHERE page_row.slug_digest = p_slug_digest
    AND page_row.state = 'PUBLISHED'
    AND page_row.deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR v_component IN
    SELECT component_row.*
    FROM public_status.components AS component_row
    WHERE component_row.owner_id = v_page.owner_id
      AND component_row.page_id = v_page.id
    ORDER BY component_row.position, component_row.id
  LOOP
    v_health := 'UNKNOWN';
    v_name := 'Unavailable component';
    v_url := NULL;
    v_response_time := NULL;
    v_last_checked := NULL;
    v_maintenance := false;
    v_incidents := NULL;

    IF v_component.check_id IS NOT NULL THEN
      SELECT
        COALESCE(component_row.display_name, check_row.name),
        CASE WHEN component_row.show_url THEN check_row.url ELSE NULL END,
        COALESCE(state_row.health_state, 'UNKNOWN'),
        state_row.last_response_time_ms,
        state_row.last_checked_at,
        app.effective_maintenance_until(check_row.owner_id, check_row.id, v_now) IS NOT NULL
      INTO v_name, v_url, v_health, v_response_time, v_last_checked, v_maintenance
      FROM public_status.components AS component_row
      JOIN app.checks AS check_row
        ON check_row.owner_id = component_row.owner_id
       AND check_row.id = component_row.check_id
       AND check_row.deleted_at IS NULL
      LEFT JOIN monitoring.check_current_states AS state_row
        ON state_row.owner_id = check_row.owner_id AND state_row.check_id = check_row.id
      WHERE component_row.id = v_component.id;

      IF v_component.show_incident_history THEN
        SELECT COALESCE(jsonb_agg(incident_row.item ORDER BY incident_row.started_at DESC), '[]'::jsonb)
        INTO v_incidents
        FROM (
          SELECT
            incident.started_at,
            jsonb_build_object(
              'started_at', incident.started_at,
              'ended_at', incident.ended_at,
              'observed_duration_ms', incident.observed_duration_ms::text
            ) AS item
          FROM monitoring.incidents AS incident
          WHERE incident.owner_id = v_page.owner_id
            AND incident.check_id = v_component.check_id
          ORDER BY incident.started_at DESC, incident.id DESC
          LIMIT 10
        ) AS incident_row;
      END IF;
    ELSE
      SELECT COALESCE(v_component.display_name, group_row.name)
      INTO v_name
      FROM app.check_groups AS group_row
      WHERE group_row.owner_id = v_page.owner_id
        AND group_row.id = v_component.group_id
        AND group_row.deleted_at IS NULL;

      SELECT
        CASE
          WHEN count(check_row.id) = 0 THEN 'UNKNOWN'
          WHEN bool_or(COALESCE(state_row.health_state, 'UNKNOWN') = 'DOWN') THEN 'DOWN'
          WHEN bool_or(COALESCE(state_row.health_state, 'UNKNOWN') = 'SUSPECT') THEN 'SUSPECT'
          WHEN bool_or(COALESCE(state_row.health_state, 'UNKNOWN') = 'UNKNOWN') THEN 'UNKNOWN'
          ELSE 'UP'
        END,
        round(avg(state_row.last_response_time_ms))::integer,
        max(state_row.last_checked_at),
        COALESCE(bool_or(app.effective_maintenance_until(check_row.owner_id, check_row.id, v_now) IS NOT NULL), false)
      INTO v_health, v_response_time, v_last_checked, v_maintenance
      FROM app.checks AS check_row
      LEFT JOIN monitoring.check_current_states AS state_row
        ON state_row.owner_id = check_row.owner_id AND state_row.check_id = check_row.id
      WHERE check_row.owner_id = v_page.owner_id
        AND check_row.group_id = v_component.group_id
        AND check_row.deleted_at IS NULL;

      v_maintenance := v_maintenance OR EXISTS (
        SELECT 1
        FROM app.maintenance_windows AS maintenance_window
        WHERE maintenance_window.owner_id = v_page.owner_id
          AND maintenance_window.group_id = v_component.group_id
          AND maintenance_window.state = 'SCHEDULED'
          AND maintenance_window.cancelled_at IS NULL
          AND maintenance_window.starts_at <= v_now
          AND maintenance_window.ends_at > v_now
      );

      IF v_component.show_incident_history THEN
        SELECT COALESCE(jsonb_agg(incident_row.item ORDER BY incident_row.started_at DESC), '[]'::jsonb)
        INTO v_incidents
        FROM (
          SELECT
            incident.started_at,
            jsonb_build_object(
              'started_at', incident.started_at,
              'ended_at', incident.ended_at,
              'observed_duration_ms', incident.observed_duration_ms::text
            ) AS item
          FROM monitoring.incidents AS incident
          WHERE incident.owner_id = v_page.owner_id
            AND incident.group_id_at_open = v_component.group_id
          ORDER BY incident.started_at DESC, incident.id DESC
          LIMIT 10
        ) AS incident_row;
      END IF;
    END IF;

    IF v_health = 'DOWN' OR (v_health = 'SUSPECT' AND v_overall <> 'DOWN')
       OR (v_health = 'UP' AND v_overall = 'UNKNOWN') THEN
      v_overall := v_health;
    END IF;

    v_components := v_components || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'id', v_component.id,
      'kind', CASE WHEN v_component.check_id IS NOT NULL THEN 'CHECK' ELSE 'GROUP' END,
      'display_name', COALESCE(v_name, 'Unavailable component'),
      'url', v_url,
      'health_state', v_health,
      'maintenance_active', v_maintenance,
      'last_response_time_ms', CASE WHEN v_component.show_response_time THEN v_response_time ELSE NULL END,
      'last_checked_at', v_last_checked,
      'incident_history', v_incidents
    )));
  END LOOP;

  RETURN QUERY SELECT jsonb_build_object(
    'title', v_page.title,
    'description', v_page.description,
    'page_revision', v_page.resource_version::text,
    'generated_at', v_now,
    'overall_health_state', v_overall,
    'components', v_components
  ), 2::smallint, v_now;
END
$function$;

REVOKE ALL ON FUNCTION security_api.read_public_snapshot(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.read_public_snapshot(bytea) TO site_monitor_public;

COMMENT ON FUNCTION security_api.read_public_snapshot(bytea) IS
  'Returns a live, allowlisted projection for a published opaque token; never exposes owner or source identifiers.';

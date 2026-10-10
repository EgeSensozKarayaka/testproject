-- migrate:transaction true

-- A data-modifying CTE's rows are visible to sibling CTEs through RETURNING,
-- not by rescanning the base table in the same statement snapshot. Include the
-- returned IDs explicitly so the first reconciliation call enqueues work.
CREATE OR REPLACE FUNCTION security_api.reconcile_open_incident_notifications()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM infra.destination_activations
    WHERE destination = 'NOTIFICATION'
  ) THEN
    RETURN 0;
  END IF;

  WITH inserted_events AS (
    INSERT INTO infra.outbox_events (
      owner_id, event_type, schema_version, aggregate_type, aggregate_id,
      aggregate_version, correlation_id, occurred_at, payload
    )
    SELECT incident.owner_id, 'incident.opened', 1, 'incident', incident.id,
           incident.resource_version, incident.confirmation_run_id,
           statement_timestamp(),
           jsonb_build_object(
             'check_id', incident.check_id,
             'confirmed_at', incident.confirmed_at,
             'incident_id', incident.id,
             'notification_reconciliation', 'cutover-v1',
             'resource_version', incident.resource_version::text,
             'started_at', incident.started_at
           )
    FROM monitoring.incidents AS incident
    WHERE incident.status = 'OPEN'
      AND NOT EXISTS (
        SELECT 1 FROM notification.intents AS intent
        WHERE intent.incident_id = incident.id
          AND intent.event_kind = 'INCIDENT_OPENED'
      )
    ON CONFLICT (aggregate_id)
      WHERE event_type = 'incident.opened'
        AND payload->>'notification_reconciliation' = 'cutover-v1'
      DO NOTHING
    RETURNING id
  ), reconciliation_events AS (
    SELECT inserted.id FROM inserted_events AS inserted
    UNION
    SELECT event.id
    FROM infra.outbox_events AS event
    JOIN monitoring.incidents AS incident ON incident.id = event.aggregate_id
    WHERE event.event_type = 'incident.opened'
      AND event.payload->>'notification_reconciliation' = 'cutover-v1'
      AND incident.status = 'OPEN'
      AND NOT EXISTS (
        SELECT 1 FROM notification.intents AS intent
        WHERE intent.incident_id = incident.id
          AND intent.event_kind = 'INCIDENT_OPENED'
      )
  )
  INSERT INTO infra.outbox_dispatches (event_id, destination)
  SELECT event.id, 'NOTIFICATION'
  FROM reconciliation_events AS event
  ON CONFLICT (event_id, destination) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$function$;

REVOKE ALL ON FUNCTION security_api.reconcile_open_incident_notifications() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION security_api.reconcile_open_incident_notifications()
  TO site_monitor_notifier;

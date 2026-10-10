-- migrate:transaction true

-- Align the original storage shape with the canonical API contract. Renaming
-- preserves any pre-existing label as the optional operator note.
ALTER TABLE app.maintenance_windows
  RENAME COLUMN name TO note;

ALTER TABLE app.maintenance_windows
  ALTER COLUMN note TYPE varchar(1000),
  ALTER COLUMN note DROP NOT NULL;

ALTER TABLE app.maintenance_windows
  DROP CONSTRAINT maintenance_windows_name_not_blank;

CREATE INDEX maintenance_owner_list_idx
  ON app.maintenance_windows (owner_id, starts_at DESC, id DESC);

-- One security-invoker projection keeps API, monitor and notification
-- decisions on the same half-open direct-check + current-group semantics.
CREATE FUNCTION app.effective_maintenance_until(
  p_owner_id uuid,
  p_check_id uuid,
  p_evaluated_at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
  SELECT max(maintenance_window.ends_at)
  FROM app.checks AS check_row
  JOIN app.maintenance_windows AS maintenance_window
    ON maintenance_window.owner_id = check_row.owner_id
   AND (
     maintenance_window.check_id = check_row.id
     OR (
       maintenance_window.group_id IS NOT NULL
       AND maintenance_window.group_id = check_row.group_id
     )
   )
  WHERE check_row.owner_id = p_owner_id
    AND check_row.id = p_check_id
    AND maintenance_window.state = 'SCHEDULED'
    AND maintenance_window.cancelled_at IS NULL
    AND maintenance_window.starts_at <= p_evaluated_at
    AND maintenance_window.ends_at > p_evaluated_at
$function$;

REVOKE ALL ON FUNCTION app.effective_maintenance_until(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.effective_maintenance_until(uuid, uuid, timestamptz)
  TO site_monitor_api, site_monitor_monitor, site_monitor_notifier;

-- Maintenance cancellation is an UPDATE state transition. The API must never
-- physically erase the audit/history row or move it to another owner/target.
REVOKE DELETE ON app.maintenance_windows FROM site_monitor_api;
REVOKE UPDATE ON app.maintenance_windows FROM site_monitor_api;
GRANT UPDATE (
  note,
  starts_at,
  ends_at,
  state,
  cancelled_at,
  resource_version,
  updated_at
) ON app.maintenance_windows TO site_monitor_api;

COMMENT ON COLUMN app.maintenance_windows.note IS
  'Optional owner-visible operator note. Never copied into logs, audit metadata or outbox payloads.';
COMMENT ON FUNCTION app.effective_maintenance_until(uuid, uuid, timestamptz) IS
  'Returns the latest end among active direct-check and current-group maintenance windows at the supplied instant.';

-- migrate:transaction true

-- Check configuration commands own a deliberately narrow part of monitoring state:
-- they may invalidate observations, suspend/close incidents, and rotate health
-- intervals. Probe execution, run acceptance, leasing, and fencing remain reserved
-- for the monitor role.
GRANT UPDATE (
  status,
  observation_mode,
  closed_at,
  closure_reason,
  observed_duration_ms,
  resource_version,
  updated_at
) ON monitoring.incidents TO site_monitor_api;

GRANT UPDATE (
  ended_at,
  close_reason,
  updated_at
) ON monitoring.incident_segments TO site_monitor_api;

GRANT INSERT, DELETE ON monitoring.open_health_intervals TO site_monitor_api;
-- PostgreSQL requires UPDATE privilege for SELECT ... FOR UPDATE. Restrict the
-- writable surface to the bookkeeping timestamp; command code only uses the
-- privilege to lock the current segment before rotating it.
GRANT UPDATE (updated_at) ON monitoring.open_health_intervals TO site_monitor_api;
GRANT INSERT ON monitoring.health_intervals TO site_monitor_api;

COMMENT ON TABLE monitoring.open_health_intervals IS
  'Current health timeline segment. API commands may rotate it; accepted observations remain monitor-owned.';

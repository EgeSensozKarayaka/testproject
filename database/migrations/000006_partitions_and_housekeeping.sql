-- migrate:transaction true

CREATE FUNCTION infra.ensure_month_partition(
  p_parent regclass,
  p_schema_name text,
  p_name_prefix text,
  p_month date
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  partition_start timestamptz := date_trunc('month', p_month::timestamp) AT TIME ZONE 'UTC';
  partition_end timestamptz := (date_trunc('month', p_month::timestamp) + interval '1 month') AT TIME ZONE 'UTC';
  partition_name text := p_name_prefix || '_' || to_char(p_month, 'YYYY_MM');
BEGIN
  IF p_schema_name NOT IN ('monitoring', 'prediction', 'audit') THEN
    RAISE EXCEPTION 'Unsupported partition schema %', p_schema_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
    p_schema_name,
    partition_name,
    p_parent,
    partition_start,
    partition_end
  );
END
$function$;

CREATE FUNCTION infra.ensure_year_partition(
  p_parent regclass,
  p_schema_name text,
  p_name_prefix text,
  p_year integer
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  partition_start timestamptz := make_date(p_year, 1, 1)::timestamp AT TIME ZONE 'UTC';
  partition_end timestamptz := make_date(p_year + 1, 1, 1)::timestamp AT TIME ZONE 'UTC';
  partition_name text := p_name_prefix || '_' || p_year::text;
BEGIN
  IF p_schema_name <> 'monitoring' THEN
    RAISE EXCEPTION 'Unsupported yearly partition schema %', p_schema_name;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I.%I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
    p_schema_name,
    partition_name,
    p_parent,
    partition_start,
    partition_end
  );
END
$function$;

CREATE FUNCTION infra.ensure_time_partitions(p_reference_date date DEFAULT current_date)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  offset_value integer;
  month_value date;
  year_value integer;
BEGIN
  FOR offset_value IN -3..3 LOOP
    month_value := (date_trunc('month', p_reference_date) + make_interval(months => offset_value))::date;
    PERFORM infra.ensure_month_partition('monitoring.check_runs'::regclass, 'monitoring', 'check_runs', month_value);
    PERFORM infra.ensure_month_partition('prediction.scores'::regclass, 'prediction', 'scores', month_value);
  END LOOP;

  FOR offset_value IN -1..3 LOOP
    month_value := (date_trunc('month', p_reference_date) + make_interval(months => offset_value))::date;
    PERFORM infra.ensure_month_partition('monitoring.health_intervals'::regclass, 'monitoring', 'health_intervals', month_value);
    PERFORM infra.ensure_month_partition('monitoring.rollups_minute'::regclass, 'monitoring', 'rollups_minute', month_value);
    PERFORM infra.ensure_month_partition('audit.events'::regclass, 'audit', 'events', month_value);
  END LOOP;

  FOR offset_value IN -1..1 LOOP
    year_value := extract(year FROM p_reference_date)::integer + offset_value;
    PERFORM infra.ensure_year_partition('monitoring.rollups_hour'::regclass, 'monitoring', 'rollups_hour', year_value);
  END LOOP;
END
$function$;

REVOKE ALL ON FUNCTION infra.ensure_month_partition(regclass, text, text, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION infra.ensure_year_partition(regclass, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION infra.ensure_time_partitions(date) FROM PUBLIC;

SELECT infra.ensure_time_partitions(current_date);

CREATE TABLE monitoring.check_runs_default PARTITION OF monitoring.check_runs DEFAULT;
CREATE TABLE monitoring.health_intervals_default PARTITION OF monitoring.health_intervals DEFAULT;
CREATE TABLE monitoring.rollups_minute_default PARTITION OF monitoring.rollups_minute DEFAULT;
CREATE TABLE monitoring.rollups_hour_default PARTITION OF monitoring.rollups_hour DEFAULT;
CREATE TABLE prediction.scores_default PARTITION OF prediction.scores DEFAULT;
CREATE TABLE audit.events_default PARTITION OF audit.events DEFAULT;

GRANT EXECUTE ON FUNCTION infra.ensure_time_partitions(date) TO site_monitor_housekeeper;

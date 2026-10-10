-- migrate:transaction true

-- Source cursors start at the documented retention boundaries. Discovery and
-- cursor advancement happen in one transaction inside the narrow function
-- below, so a crash cannot acknowledge work that was not enqueued.
INSERT INTO monitoring.rollup_checkpoints (processor_name, watermark_at)
VALUES
  ('runs-minute-source', statement_timestamp() - interval '90 days'),
  ('intervals-minute-source', statement_timestamp() - interval '400 days'),
  ('minute-projection', statement_timestamp() - interval '90 days'),
  ('hour-projection', statement_timestamp() - interval '400 days')
ON CONFLICT (processor_name) DO NOTHING;

CREATE FUNCTION security_api.housekeeping_discover_sources(p_batch_size integer)
RETURNS TABLE (run_sources integer, interval_sources integer, ranges_enqueued integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_interval_enqueued integer := 0;
  v_interval_sources integer := 0;
  v_run_enqueued integer := 0;
  v_run_sources integer := 0;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 5000'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize each cursor, not the whole worker. Different discovery sources
  -- can progress independently and two replicas converge through the unique
  -- source fingerprint.
  PERFORM 1
  FROM monitoring.rollup_checkpoints
  WHERE processor_name = 'runs-minute-source'
  FOR UPDATE;

  WITH selected AS MATERIALIZED (
    SELECT run.recorded_at, run.owner_id, run.check_id, run.finished_at, run.id
    FROM monitoring.check_runs AS run
    CROSS JOIN monitoring.rollup_checkpoints AS checkpoint
    WHERE checkpoint.processor_name = 'runs-minute-source'
      AND run.accepted_for_state
      AND (
        (checkpoint.cursor_owner_id IS NULL AND run.recorded_at >= checkpoint.watermark_at)
        OR (
          checkpoint.cursor_owner_id IS NOT NULL
          AND (run.recorded_at, run.owner_id, run.check_id, run.finished_at, run.id) >
              (checkpoint.watermark_at, checkpoint.cursor_owner_id,
               checkpoint.cursor_check_id, checkpoint.cursor_source_at,
               checkpoint.cursor_source_id)
        )
      )
    ORDER BY run.recorded_at, run.owner_id, run.check_id, run.finished_at, run.id
    LIMIT p_batch_size
  ), grouped AS (
    SELECT owner_id, check_id, date_trunc('minute', finished_at) AS range_start,
           date_trunc('minute', finished_at) + interval '1 minute' AS range_end,
           sha256(convert_to(
             'runs:' || min(recorded_at)::text || ':' || max(recorded_at)::text || ':' ||
             string_agg(id::text, ',' ORDER BY recorded_at, owner_id, check_id, finished_at, id),
             'UTF8'
           )) AS source_fingerprint
    FROM selected
    GROUP BY owner_id, check_id, date_trunc('minute', finished_at)
  ), enqueued AS (
    INSERT INTO monitoring.rollup_rebuild_ranges (
      owner_id, check_id, resolution, range_start, range_end,
      next_bucket_start, reason, source_fingerprint
    )
    SELECT owner_id, check_id, 'MINUTE', range_start, range_end,
           range_start, 'RUN_RECORDED', source_fingerprint
    FROM grouped
    ON CONFLICT (owner_id, check_id, resolution, source_fingerprint) DO NOTHING
    RETURNING 1
  ), last_source AS (
    SELECT *
    FROM selected
    ORDER BY recorded_at DESC, owner_id DESC, check_id DESC, finished_at DESC, id DESC
    LIMIT 1
  ), checkpoint_updated AS (
    UPDATE monitoring.rollup_checkpoints AS checkpoint
    SET watermark_at = source.recorded_at,
        cursor_owner_id = source.owner_id,
        cursor_check_id = source.check_id,
        cursor_source_at = source.finished_at,
        cursor_source_id = source.id,
        updated_at = statement_timestamp(),
        last_error_code = NULL,
        revision = checkpoint.revision + 1
    FROM last_source AS source
    WHERE checkpoint.processor_name = 'runs-minute-source'
    RETURNING 1
  )
  SELECT (SELECT count(*)::integer FROM selected),
         (SELECT count(*)::integer FROM enqueued) +
           (SELECT count(*)::integer * 0 FROM checkpoint_updated)
  INTO v_run_sources, v_run_enqueued;

  PERFORM 1
  FROM monitoring.rollup_checkpoints
  WHERE processor_name = 'intervals-minute-source'
  FOR UPDATE;

  WITH selected AS MATERIALIZED (
    SELECT interval_row.finalized_at, interval_row.owner_id,
           interval_row.check_id, interval_row.started_at, interval_row.id,
           interval_row.ended_at
    FROM monitoring.health_intervals AS interval_row
    CROSS JOIN monitoring.rollup_checkpoints AS checkpoint
    WHERE checkpoint.processor_name = 'intervals-minute-source'
      AND (
        (checkpoint.cursor_owner_id IS NULL
         AND interval_row.finalized_at >= checkpoint.watermark_at)
        OR (
          checkpoint.cursor_owner_id IS NOT NULL
          AND (interval_row.finalized_at, interval_row.owner_id,
               interval_row.check_id, interval_row.started_at, interval_row.id) >
              (checkpoint.watermark_at, checkpoint.cursor_owner_id,
               checkpoint.cursor_check_id, checkpoint.cursor_source_at,
               checkpoint.cursor_source_id)
        )
      )
    ORDER BY interval_row.finalized_at, interval_row.owner_id,
             interval_row.check_id, interval_row.started_at, interval_row.id
    LIMIT p_batch_size
  ), grouped AS (
    SELECT owner_id, check_id, min(date_trunc('minute', started_at)) AS range_start,
           max(date_trunc('minute', ended_at - interval '1 microsecond') + interval '1 minute')
             AS range_end,
           sha256(convert_to(
             'intervals:' || min(finalized_at)::text || ':' || max(finalized_at)::text || ':' ||
             string_agg(id::text, ',' ORDER BY finalized_at, owner_id, check_id, started_at, id),
             'UTF8'
           )) AS source_fingerprint
    FROM selected
    GROUP BY owner_id, check_id
  ), enqueued AS (
    INSERT INTO monitoring.rollup_rebuild_ranges (
      owner_id, check_id, resolution, range_start, range_end,
      next_bucket_start, reason, source_fingerprint
    )
    SELECT owner_id, check_id, 'MINUTE', range_start, range_end,
           range_start, 'INTERVAL_FINALIZED', source_fingerprint
    FROM grouped
    ON CONFLICT (owner_id, check_id, resolution, source_fingerprint) DO NOTHING
    RETURNING 1
  ), last_source AS (
    SELECT *
    FROM selected
    ORDER BY finalized_at DESC, owner_id DESC, check_id DESC, started_at DESC, id DESC
    LIMIT 1
  ), checkpoint_updated AS (
    UPDATE monitoring.rollup_checkpoints AS checkpoint
    SET watermark_at = source.finalized_at,
        cursor_owner_id = source.owner_id,
        cursor_check_id = source.check_id,
        cursor_source_at = source.started_at,
        cursor_source_id = source.id,
        updated_at = statement_timestamp(),
        last_error_code = NULL,
        revision = checkpoint.revision + 1
    FROM last_source AS source
    WHERE checkpoint.processor_name = 'intervals-minute-source'
    RETURNING 1
  )
  SELECT (SELECT count(*)::integer FROM selected),
         (SELECT count(*)::integer FROM enqueued) +
           (SELECT count(*)::integer * 0 FROM checkpoint_updated)
  INTO v_interval_sources, v_interval_enqueued;

  RETURN QUERY SELECT v_run_sources, v_interval_sources,
                      v_run_enqueued + v_interval_enqueued;
END
$function$;

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
DECLARE
  v_bucket_end timestamptz;
  v_bucket_start timestamptz;
  v_processed integer := 0;
  v_range monitoring.rollup_rebuild_ranges%ROWTYPE;
  v_step interval;
BEGIN
  IF p_resolution NOT IN ('MINUTE', 'HOUR') THEN
    RAISE EXCEPTION 'resolution must be MINUTE or HOUR' USING ERRCODE = '22023';
  END IF;
  IF p_bucket_limit < 1 OR p_bucket_limit > 1440 THEN
    RAISE EXCEPTION 'bucket limit must be between 1 and 1440' USING ERRCODE = '22023';
  END IF;
  v_step := CASE p_resolution WHEN 'MINUTE' THEN interval '1 minute' ELSE interval '1 hour' END;

  SELECT range_row.* INTO v_range
  FROM monitoring.rollup_rebuild_ranges AS range_row
  WHERE range_row.resolution = p_resolution
    AND range_row.state = 'PENDING'
  ORDER BY range_row.created_at, range_row.id
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 0, false;
    RETURN;
  END IF;

  v_bucket_start := v_range.next_bucket_start;
  WHILE v_bucket_start < v_range.range_end AND v_processed < p_bucket_limit LOOP
    v_bucket_end := least(v_bucket_start + v_step, v_range.range_end);

    IF p_resolution = 'MINUTE' THEN
      DELETE FROM monitoring.rollups_minute AS rollup
      WHERE rollup.owner_id = v_range.owner_id
        AND rollup.check_id = v_range.check_id
        AND rollup.bucket_start = v_bucket_start;

      INSERT INTO monitoring.rollups_minute (
        bucket_start, owner_id, check_id, probe_generation,
        accepted_run_count, pass_count, fail_count, response_sample_count,
        response_sum_ms, response_min_ms, response_max_ms,
        computed_through, revision
      )
      SELECT v_bucket_start, run.owner_id, run.check_id, run.probe_generation,
             count(*)::integer,
             count(*) FILTER (WHERE run.outcome = 'PASS')::integer,
             count(*) FILTER (WHERE run.outcome = 'FAIL')::integer,
             count(*)::integer, sum(run.total_ms)::bigint,
             min(run.total_ms), max(run.total_ms), statement_timestamp(), 1
      FROM monitoring.check_runs AS run
      WHERE run.owner_id = v_range.owner_id
        AND run.check_id = v_range.check_id
        AND run.accepted_for_state
        AND run.finished_at >= v_bucket_start
        AND run.finished_at < v_bucket_end
      GROUP BY run.owner_id, run.check_id, run.probe_generation;

      INSERT INTO monitoring.rollups_minute (
        bucket_start, owner_id, check_id, probe_generation,
        up_ms, down_ms, unknown_ms, provisional_ms,
        computed_through, revision
      )
      SELECT v_bucket_start, interval_row.owner_id, interval_row.check_id,
             interval_row.probe_generation,
             coalesce(sum(duration_ms) FILTER (WHERE classification = 'UP'), 0)::bigint,
             coalesce(sum(duration_ms) FILTER (WHERE classification = 'DOWN'), 0)::bigint,
             coalesce(sum(duration_ms) FILTER (WHERE classification = 'UNKNOWN'), 0)::bigint,
             0, statement_timestamp(), 1
      FROM (
        SELECT source.owner_id, source.check_id, source.probe_generation,
               source.classification,
               round(extract(epoch FROM (
                 least(source.ended_at, v_bucket_end) -
                 greatest(source.started_at, v_bucket_start)
               )) * 1000)::bigint AS duration_ms
        FROM monitoring.health_intervals AS source
        WHERE source.owner_id = v_range.owner_id
          AND source.check_id = v_range.check_id
          AND source.started_at < v_bucket_end
          AND source.ended_at > v_bucket_start
      ) AS interval_row
      GROUP BY interval_row.owner_id, interval_row.check_id, interval_row.probe_generation
      ON CONFLICT (owner_id, check_id, bucket_start, probe_generation)
      DO UPDATE SET
        up_ms = EXCLUDED.up_ms,
        down_ms = EXCLUDED.down_ms,
        unknown_ms = EXCLUDED.unknown_ms,
        provisional_ms = EXCLUDED.provisional_ms,
        computed_through = EXCLUDED.computed_through,
        revision = monitoring.rollups_minute.revision + 1,
        updated_at = statement_timestamp();

      INSERT INTO monitoring.rollup_rebuild_ranges (
        owner_id, check_id, resolution, range_start, range_end,
        next_bucket_start, reason, source_fingerprint
      ) VALUES (
        v_range.owner_id, v_range.check_id, 'HOUR',
        date_trunc('hour', v_bucket_start),
        date_trunc('hour', v_bucket_start) + interval '1 hour',
        date_trunc('hour', v_bucket_start), 'MINUTE_CHANGED',
        sha256(convert_to(v_range.id::text || ':' || v_bucket_start::text, 'UTF8'))
      )
      ON CONFLICT (owner_id, check_id, resolution, source_fingerprint) DO NOTHING;
    ELSE
      DELETE FROM monitoring.rollups_hour AS rollup
      WHERE rollup.owner_id = v_range.owner_id
        AND rollup.check_id = v_range.check_id
        AND rollup.bucket_start = v_bucket_start;

      INSERT INTO monitoring.rollups_hour (
        bucket_start, owner_id, check_id, probe_generation,
        accepted_run_count, pass_count, fail_count, response_sample_count,
        response_sum_ms, response_min_ms, response_max_ms,
        up_ms, down_ms, unknown_ms, provisional_ms,
        computed_through, revision
      )
      SELECT v_bucket_start, minute.owner_id, minute.check_id, minute.probe_generation,
             sum(minute.accepted_run_count)::integer,
             sum(minute.pass_count)::integer,
             sum(minute.fail_count)::integer,
             sum(minute.response_sample_count)::integer,
             sum(minute.response_sum_ms)::bigint,
             min(minute.response_min_ms), max(minute.response_max_ms),
             sum(minute.up_ms)::bigint, sum(minute.down_ms)::bigint,
             sum(minute.unknown_ms)::bigint, sum(minute.provisional_ms)::bigint,
             max(minute.computed_through), 1
      FROM monitoring.rollups_minute AS minute
      WHERE minute.owner_id = v_range.owner_id
        AND minute.check_id = v_range.check_id
        AND minute.bucket_start >= v_bucket_start
        AND minute.bucket_start < v_bucket_end
      GROUP BY minute.owner_id, minute.check_id, minute.probe_generation;
    END IF;

    v_processed := v_processed + 1;
    v_bucket_start := v_bucket_start + v_step;
  END LOOP;

  UPDATE monitoring.rollup_rebuild_ranges AS range_row
  SET next_bucket_start = least(v_bucket_start, range_row.range_end),
      state = CASE WHEN v_bucket_start >= range_row.range_end THEN 'COMPLETED' ELSE 'PENDING' END,
      attempt_count = range_row.attempt_count + 1,
      last_error_code = NULL,
      updated_at = statement_timestamp()
  WHERE range_row.id = v_range.id;

  UPDATE monitoring.rollup_checkpoints AS checkpoint
  SET data_through = greatest(coalesce(checkpoint.data_through, '-infinity'::timestamptz),
                              least(v_bucket_start, v_range.range_end)),
      updated_at = statement_timestamp(),
      revision = checkpoint.revision + 1
  WHERE checkpoint.processor_name =
    CASE p_resolution WHEN 'MINUTE' THEN 'minute-projection' ELSE 'hour-projection' END;

  RETURN QUERY SELECT v_range.id, v_processed, v_bucket_start >= v_range.range_end;
END
$function$;

CREATE FUNCTION security_api.housekeeping_partition_step()
RETURNS TABLE (default_row_count bigint, future_partitions_ready boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_default_count bigint;
  v_ready boolean;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('site-monitor:partition-ensure:v1')) THEN
    RETURN QUERY SELECT 0::bigint, true;
    RETURN;
  END IF;

  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM infra.ensure_time_partitions(current_date);

  SELECT
    (SELECT count(*) FROM monitoring.check_runs_default) +
    (SELECT count(*) FROM monitoring.health_intervals_default) +
    (SELECT count(*) FROM monitoring.rollups_minute_default) +
    (SELECT count(*) FROM monitoring.rollups_hour_default)
  INTO v_default_count;

  SELECT bool_and(relation_name IS NOT NULL)
  INTO v_ready
  FROM (
    SELECT to_regclass(format('monitoring.check_runs_%s',
             to_char(current_date + make_interval(months => offset_value), 'YYYY_MM')))
             AS relation_name
    FROM generate_series(0, 3) AS offset_value
    UNION ALL
    SELECT to_regclass(format('monitoring.health_intervals_%s',
             to_char(current_date + make_interval(months => offset_value), 'YYYY_MM')))
    FROM generate_series(0, 3) AS offset_value
    UNION ALL
    SELECT to_regclass(format('monitoring.rollups_minute_%s',
             to_char(current_date + make_interval(months => offset_value), 'YYYY_MM')))
    FROM generate_series(0, 3) AS offset_value
    UNION ALL
    SELECT to_regclass(format('monitoring.rollups_hour_%s',
             extract(year FROM current_date)::integer + offset_value))
    FROM generate_series(0, 1) AS offset_value
  ) AS required;

  RETURN QUERY SELECT v_default_count, coalesce(v_ready, false);
END
$function$;

CREATE FUNCTION security_api.housekeeping_retention_step(p_batch_size integer)
RETURNS TABLE (action text, purged_rows integer)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_action text := 'NONE';
  v_child record;
  v_count integer;
  v_cutoff timestamptz;
  v_end timestamptz;
  v_manifest record;
  v_max_ended timestamptz;
  v_parent text;
  v_purged integer := 0;
  v_start timestamptz;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 5000' USING ERRCODE = '22023';
  END IF;

  -- DDL is single-concurrency across replicas. Row purge still proceeds when
  -- another replica owns this transaction-scoped lock.
  IF pg_try_advisory_xact_lock(hashtext('site-monitor:partition-retention:v1')) THEN
    SELECT manifest.* INTO v_manifest
    FROM infra.partition_retention_runs AS manifest
    WHERE manifest.state = 'DETACHED'
      AND manifest.drop_after <= statement_timestamp()
    ORDER BY manifest.drop_after, manifest.id
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF FOUND THEN
      EXECUTE format('DROP TABLE IF EXISTS %I.%I',
                     v_manifest.child_schema, v_manifest.child_name);
      UPDATE infra.partition_retention_runs
      SET state = 'DROPPED', dropped_at = statement_timestamp(),
          updated_at = statement_timestamp(), last_error_code = NULL
      WHERE id = v_manifest.id;
      v_action := 'DROPPED';
    ELSE
      FOR v_child IN
        SELECT parent_ns.nspname || '.' || parent.relname AS parent_relation,
               child_ns.nspname AS child_schema, child.relname AS child_name
        FROM pg_inherits AS inheritance
        JOIN pg_class AS parent ON parent.oid = inheritance.inhparent
        JOIN pg_namespace AS parent_ns ON parent_ns.oid = parent.relnamespace
        JOIN pg_class AS child ON child.oid = inheritance.inhrelid
        JOIN pg_namespace AS child_ns ON child_ns.oid = child.relnamespace
        WHERE parent_ns.nspname = 'monitoring'
          AND parent.relname IN ('check_runs', 'health_intervals', 'rollups_minute', 'rollups_hour')
          AND child.relname NOT LIKE '%_default'
        ORDER BY parent.relname, child.relname
      LOOP
        v_parent := v_child.parent_relation;
        IF v_parent = 'monitoring.rollups_hour' THEN
          IF v_child.child_name !~ '^rollups_hour_[0-9]{4}$' THEN CONTINUE; END IF;
          v_start := make_date(right(v_child.child_name, 4)::integer, 1, 1)::timestamp AT TIME ZONE 'UTC';
          v_end := v_start + interval '1 year';
          v_cutoff := statement_timestamp() - interval '400 days';
        ELSE
          IF v_child.child_name !~ '_(19|20)[0-9]{2}_(0[1-9]|1[0-2])$' THEN CONTINUE; END IF;
          v_start := to_date(right(v_child.child_name, 7), 'YYYY_MM')::timestamp AT TIME ZONE 'UTC';
          v_end := v_start + interval '1 month';
          v_cutoff := statement_timestamp() - CASE v_parent
            WHEN 'monitoring.check_runs' THEN interval '90 days'
            WHEN 'monitoring.health_intervals' THEN interval '400 days'
            ELSE interval '35 days'
          END;
        END IF;

        IF v_end > v_cutoff THEN CONTINUE; END IF;
        IF v_parent = 'monitoring.health_intervals' THEN
          EXECUTE format('SELECT max(ended_at) FROM %I.%I',
                         v_child.child_schema, v_child.child_name)
            INTO v_max_ended;
          IF v_max_ended IS NOT NULL AND v_max_ended >= v_cutoff THEN CONTINUE; END IF;
        END IF;

        EXECUTE format('SELECT count(*)::integer FROM %I.%I',
                       v_child.child_schema, v_child.child_name)
          INTO v_count;
        INSERT INTO infra.partition_retention_runs (
          parent_relation, child_schema, child_name, partition_start,
          partition_end, row_count, state, detached_at, drop_after
        ) VALUES (
          v_parent, v_child.child_schema, v_child.child_name, v_start,
          v_end, v_count, 'DETACHED', statement_timestamp(),
          statement_timestamp() + interval '24 hours'
        )
        ON CONFLICT DO NOTHING;
        IF FOUND THEN
          EXECUTE format('ALTER TABLE %s DETACH PARTITION %I.%I',
                         v_parent, v_child.child_schema, v_child.child_name);
          v_action := 'DETACHED';
          EXIT;
        END IF;
      END LOOP;
    END IF;
  END IF;

  WITH candidates AS (
    SELECT id FROM infra.api_idempotency_records
    WHERE expires_at <= statement_timestamp()
    ORDER BY expires_at, id LIMIT p_batch_size
  )
  DELETE FROM infra.api_idempotency_records AS receipt
  USING candidates WHERE receipt.id = candidates.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  WITH candidates AS (
    SELECT attempt.id
    FROM monitoring.check_job_attempts AS attempt
    JOIN monitoring.check_jobs AS job ON job.id = attempt.job_id
    WHERE job.state IN ('COMPLETED', 'CANCELLED', 'DEAD')
      AND job.completed_at < statement_timestamp() - interval '30 days'
    ORDER BY attempt.ended_at NULLS FIRST, attempt.id LIMIT p_batch_size
  )
  DELETE FROM monitoring.check_job_attempts AS attempt
  USING candidates WHERE attempt.id = candidates.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  WITH candidates AS (
    SELECT job.id FROM monitoring.check_jobs AS job
    WHERE job.state IN ('COMPLETED', 'CANCELLED', 'DEAD')
      AND job.completed_at < statement_timestamp() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM monitoring.check_job_attempts AS attempt WHERE attempt.job_id = job.id)
    ORDER BY job.completed_at, job.id LIMIT p_batch_size
  )
  DELETE FROM monitoring.check_jobs AS job
  USING candidates WHERE job.id = candidates.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  WITH candidates AS (
    SELECT dispatch.event_id, dispatch.destination
    FROM infra.outbox_dispatches AS dispatch
    WHERE dispatch.state = 'COMPLETED'
      AND dispatch.completed_at < statement_timestamp() - interval '30 days'
    ORDER BY dispatch.completed_at, dispatch.event_id, dispatch.destination
    LIMIT p_batch_size
  )
  DELETE FROM infra.outbox_dispatches AS dispatch
  USING candidates
  WHERE dispatch.event_id = candidates.event_id
    AND dispatch.destination = candidates.destination;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  WITH candidates AS (
    SELECT event.id FROM infra.outbox_events AS event
    WHERE event.created_at < statement_timestamp() - interval '30 days'
      AND NOT EXISTS (SELECT 1 FROM infra.outbox_dispatches AS dispatch WHERE dispatch.event_id = event.id)
      AND NOT EXISTS (SELECT 1 FROM notification.intents AS intent WHERE intent.source_event_id = event.id)
    ORDER BY event.created_at, event.id LIMIT p_batch_size
  )
  DELETE FROM infra.outbox_events AS event
  USING candidates WHERE event.id = candidates.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  WITH eligible_incidents AS (
    SELECT incident.id
    FROM monitoring.incidents AS incident
    WHERE incident.status = 'CLOSED'
      AND incident.closed_at < statement_timestamp() - interval '400 days'
      AND NOT EXISTS (SELECT 1 FROM notification.intents AS intent WHERE intent.incident_id = incident.id)
    ORDER BY incident.closed_at, incident.id LIMIT p_batch_size
  )
  DELETE FROM monitoring.incident_segments AS segment
  USING eligible_incidents WHERE segment.incident_id = eligible_incidents.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  WITH candidates AS (
    SELECT incident.id
    FROM monitoring.incidents AS incident
    WHERE incident.status = 'CLOSED'
      AND incident.closed_at < statement_timestamp() - interval '400 days'
      AND NOT EXISTS (SELECT 1 FROM notification.intents AS intent WHERE intent.incident_id = incident.id)
      AND NOT EXISTS (SELECT 1 FROM monitoring.incident_segments AS segment WHERE segment.incident_id = incident.id)
      AND NOT EXISTS (SELECT 1 FROM monitoring.check_current_states AS state WHERE state.open_incident_id = incident.id)
    ORDER BY incident.closed_at, incident.id LIMIT p_batch_size
  )
  DELETE FROM monitoring.incidents AS incident
  USING candidates WHERE incident.id = candidates.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  WITH candidates AS (
    SELECT evidence.owner_id, evidence.check_id, evidence.finished_at, evidence.id
    FROM monitoring.run_evidence AS evidence
    WHERE evidence.created_at < statement_timestamp() - interval '2 days'
      AND NOT EXISTS (SELECT 1 FROM monitoring.incidents AS incident
        WHERE incident.owner_id = evidence.owner_id AND incident.check_id = evidence.check_id
          AND (incident.first_failure_run_id = evidence.id OR incident.confirmation_run_id = evidence.id))
      AND NOT EXISTS (SELECT 1 FROM monitoring.incident_segments AS segment
        WHERE segment.owner_id = evidence.owner_id AND segment.check_id = evidence.check_id
          AND (segment.start_run_id = evidence.id OR segment.end_run_id = evidence.id))
      AND NOT EXISTS (SELECT 1 FROM monitoring.check_current_states AS state
        WHERE state.owner_id = evidence.owner_id AND state.check_id = evidence.check_id
          AND (state.candidate_run_id = evidence.id OR state.last_accepted_run_id = evidence.id))
      AND NOT EXISTS (SELECT 1 FROM monitoring.open_health_intervals AS open_interval
        WHERE open_interval.owner_id = evidence.owner_id AND open_interval.check_id = evidence.check_id
          AND open_interval.source_run_id = evidence.id)
      AND NOT EXISTS (SELECT 1 FROM monitoring.health_intervals AS interval_row
        WHERE interval_row.owner_id = evidence.owner_id AND interval_row.check_id = evidence.check_id
          AND interval_row.source_run_id = evidence.id)
    ORDER BY evidence.created_at, evidence.owner_id, evidence.check_id, evidence.finished_at, evidence.id
    LIMIT p_batch_size
  )
  DELETE FROM monitoring.run_evidence AS evidence
  USING candidates
  WHERE evidence.owner_id = candidates.owner_id
    AND evidence.check_id = candidates.check_id
    AND evidence.finished_at = candidates.finished_at
    AND evidence.id = candidates.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_purged := v_purged + v_count;

  RETURN QUERY SELECT v_action, v_purged;
END
$function$;

CREATE FUNCTION security_api.housekeeping_storage_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
  SELECT
    to_regprocedure('security_api.housekeeping_discover_sources(integer)') IS NOT NULL
    AND to_regprocedure('security_api.housekeeping_process_rollup_range(text,integer)') IS NOT NULL
    AND to_regprocedure('security_api.housekeeping_partition_step()') IS NOT NULL
    AND to_regprocedure('security_api.housekeeping_retention_step(integer)') IS NOT NULL
    AND (SELECT count(*) = 4 FROM monitoring.rollup_checkpoints
         WHERE processor_name IN (
           'runs-minute-source', 'intervals-minute-source',
           'minute-projection', 'hour-projection'
         ))
$function$;

REVOKE ALL ON FUNCTION security_api.housekeeping_discover_sources(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.housekeeping_process_rollup_range(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.housekeeping_partition_step() FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.housekeeping_retention_step(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION security_api.housekeeping_storage_ready() FROM PUBLIC;

GRANT USAGE ON SCHEMA security_api TO site_monitor_housekeeper;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_discover_sources(integer)
  TO site_monitor_housekeeper;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_process_rollup_range(text, integer)
  TO site_monitor_housekeeper;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_partition_step()
  TO site_monitor_housekeeper;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_retention_step(integer)
  TO site_monitor_housekeeper;
GRANT EXECUTE ON FUNCTION security_api.housekeeping_storage_ready()
  TO site_monitor_housekeeper;

COMMENT ON FUNCTION security_api.housekeeping_discover_sources(integer) IS
  'Atomically advances full-tuple source cursors and enqueues idempotent bounded rebuild ranges.';
COMMENT ON FUNCTION security_api.housekeeping_process_rollup_range(text, integer) IS
  'Claims one rebuild range with SKIP LOCKED and recomputes a bounded number of source-of-truth buckets.';
COMMENT ON FUNCTION security_api.housekeeping_retention_step(integer) IS
  'Performs at most one partition lifecycle action plus bounded reference-aware row purges.';

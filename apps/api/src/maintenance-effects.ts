import type { PoolClient } from '@site-monitor/database';
import { writeActivatedOutboxEvent } from '@site-monitor/database';

export type MaintenanceCancellationReason = 'CHECK_DELETED' | 'GROUP_DELETED';
export type MaintenanceCancellationTarget = 'CHECK' | 'GROUP';

interface CancelledMaintenanceRow {
  cancelled_at: Date | string;
  id: string;
  resource_version: string;
}

function instant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

export async function cancelOpenMaintenanceForTarget(
  client: PoolClient,
  input: {
    correlationId: string;
    ownerId: string;
    reason: MaintenanceCancellationReason;
    targetId: string;
    targetType: MaintenanceCancellationTarget;
  },
): Promise<number> {
  const targetColumn = input.targetType === 'CHECK' ? 'check_id' : 'group_id';
  const candidates = await client.query<{ id: string }>(
    `SELECT id
     FROM app.maintenance_windows
     WHERE owner_id = $1 AND ${targetColumn} = $2
       AND state = 'SCHEDULED' AND ends_at > clock_timestamp()
     ORDER BY id
     FOR UPDATE`,
    [input.ownerId, input.targetId],
  );
  const candidateIds = candidates.rows.map((row) => row.id);
  if (candidateIds.length === 0) return 0;

  const cancelled = await client.query<CancelledMaintenanceRow>(
    `UPDATE app.maintenance_windows
     SET state = 'CANCELLED', cancelled_at = clock_timestamp(),
         resource_version = resource_version + 1,
         updated_at = statement_timestamp()
     WHERE owner_id = $1 AND id = ANY($2::uuid[])
       AND state = 'SCHEDULED' AND ends_at > clock_timestamp()
     RETURNING id, cancelled_at, resource_version::text`,
    [input.ownerId, candidateIds],
  );
  cancelled.rows.sort((left, right) => left.id.localeCompare(right.id));

  for (const window of cancelled.rows) {
    await writeActivatedOutboxEvent(client, {
      aggregateId: window.id,
      aggregateType: 'maintenance_window',
      aggregateVersion: window.resource_version,
      correlationId: input.correlationId,
      destinations: ['NOTIFICATION', 'REALTIME'],
      eventType: 'maintenance.cancelled',
      ownerId: input.ownerId,
      payload: {
        cancelled_at: instant(window.cancelled_at),
        maintenance_id: window.id,
        reason_code: input.reason,
        resource_version: window.resource_version,
        target_id: input.targetId,
        target_type: input.targetType,
      },
    });
  }

  await client.query(
    `INSERT INTO audit.events
       (occurred_at, owner_id, actor_type, actor_id, action, resource_type,
        resource_id, correlation_id, result, metadata)
     SELECT statement_timestamp(), $1::uuid, 'USER', $1::text,
            'maintenance.cancelled', 'maintenance_window', cancelled_id,
            $2::uuid, 'SUCCESS',
            jsonb_build_object('reason_code', $4::text, 'target_type', $5::text)
     FROM unnest($3::uuid[]) AS cancelled(cancelled_id)`,
    [
      input.ownerId,
      input.correlationId,
      cancelled.rows.map((row) => row.id),
      input.reason,
      input.targetType,
    ],
  );
  return cancelled.rowCount ?? 0;
}

import type { PoolClient } from 'pg';

export type OutboxDestination = 'AUDIT' | 'NOTIFICATION' | 'PREDICTION' | 'REALTIME';

export interface ActivatedOutboxEventInput {
  aggregateId: string;
  aggregateType: string;
  aggregateVersion: bigint | number | string | null;
  causationId?: string | null;
  correlationId: string;
  destinations: OutboxDestination[];
  eventType: string;
  ownerId: string | null;
  payload: Record<string, unknown>;
  schemaVersion?: number;
}

export interface ActivatedOutboxEventResult {
  destinations: OutboxDestination[];
  eventId: string | null;
}

/**
 * Writes the event and its active destination dispatches through the caller's
 * open transaction. The caller owns commit/rollback so this write remains
 * atomic with the domain mutation that produced the event.
 */
export async function writeActivatedOutboxEvent(
  client: PoolClient,
  input: ActivatedOutboxEventInput,
): Promise<ActivatedOutboxEventResult> {
  const requestedDestinations = [...new Set(input.destinations)];
  if (requestedDestinations.length === 0) return { destinations: [], eventId: null };

  const active = await client.query<{ destination: OutboxDestination; event_id: string }>(
    `WITH event_identity AS MATERIALIZED (SELECT uuidv7() AS event_id)
     SELECT event_identity.event_id::text, activation.destination
     FROM event_identity
     CROSS JOIN infra.destination_activations AS activation
     WHERE activation.destination = ANY($1::text[])
     ORDER BY activation.destination`,
    [requestedDestinations],
  );
  const eventId = active.rows[0]?.event_id;
  if (!eventId) return { destinations: [], eventId: null };

  const activeDestinations = active.rows.map((row) => row.destination);
  await client.query(
    `INSERT INTO infra.outbox_events
       (id, owner_id, event_type, schema_version, aggregate_type, aggregate_id,
        aggregate_version, correlation_id, causation_id, occurred_at, payload)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid, $7::bigint, $8::uuid,
             $9::uuid, statement_timestamp(), $10::jsonb)`,
    [
      eventId,
      input.ownerId,
      input.eventType,
      input.schemaVersion ?? 1,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion,
      input.correlationId,
      input.causationId ?? null,
      JSON.stringify(input.payload),
    ],
  );
  await client.query(
    `INSERT INTO infra.outbox_dispatches (event_id, destination)
     SELECT $1::uuid, destination
     FROM unnest($2::text[]) AS requested(destination)`,
    [eventId, activeDestinations],
  );

  return {
    destinations: activeDestinations,
    eventId,
  };
}

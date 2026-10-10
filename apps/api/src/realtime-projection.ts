import {
  internalRealtimeWakeupSchema,
  privateRealtimeEventSchema,
  type InternalRealtimeWakeup,
  type PrivateRealtimeEvent,
} from '@site-monitor/contracts';
import { type Pool, withUserTransaction } from '@site-monitor/database';

function configFields(eventType: string): string[] {
  const fields: Record<string, string[]> = {
    'check.created': ['created'],
    'check.deleted': ['deleted'],
    'check.group_changed': ['group_id'],
    'check.manual_run_requested': ['manual_run'],
    'check.metadata_changed': ['name'],
    'check.paused': ['execution_state'],
    'check.probe_configuration_changed': ['probe_configuration'],
    'check.resumed': ['execution_state'],
    'check.schedule_changed': ['schedule'],
    'group.changed': ['name', 'description'],
    'group.created': ['created'],
    'group.deleted': ['deleted'],
  };
  return fields[eventType] ?? ['configuration'];
}

function event(
  wakeup: InternalRealtimeWakeup,
  input: Pick<PrivateRealtimeEvent, 'event_type' | 'payload' | 'resource'>,
): PrivateRealtimeEvent {
  return privateRealtimeEventSchema.parse({
    event_id: wakeup.event_id,
    event_type: input.event_type,
    occurred_at: wakeup.occurred_at,
    payload: input.payload,
    resource: input.resource,
    schema_version: 1,
  });
}

export interface RealtimeProjectionPort {
  project(wakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined>;
}

export class RealtimeProjectionService implements RealtimeProjectionPort {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async project(rawWakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined> {
    const wakeup = internalRealtimeWakeupSchema.parse(rawWakeup);
    if (wakeup.event_type.startsWith('check.')) return this.#check(wakeup);
    if (wakeup.event_type.startsWith('group.')) {
      return event(wakeup, {
        event_type: 'group.changed',
        payload: { changed_fields: configFields(wakeup.event_type) },
        resource: {
          id: wakeup.aggregate_id,
          type: 'group',
          version: wakeup.aggregate_version,
        },
      });
    }
    if (wakeup.event_type.startsWith('incident.')) return this.#incident(wakeup);
    if (wakeup.event_type.startsWith('maintenance.')) return this.#maintenance(wakeup);
    if (wakeup.event_type.startsWith('notification.')) return this.#notification(wakeup);
    if (wakeup.event_type.startsWith('public_page.')) return this.#publicPage(wakeup);
    if (wakeup.event_type.startsWith('prediction.')) return this.#prediction(wakeup);
    return undefined;
  }

  async #check(wakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined> {
    if (
      !['check.observation_accepted', 'check.health_changed', 'check.freshness_changed'].includes(
        wakeup.event_type,
      )
    ) {
      return event(wakeup, {
        event_type: 'check.changed',
        payload: { changed_fields: configFields(wakeup.event_type) },
        resource: {
          id: wakeup.aggregate_id,
          type: 'check',
          version: wakeup.aggregate_version,
        },
      });
    }

    return withUserTransaction(this.#pool, wakeup.owner_id, async (client) => {
      const result = await client.query<{
        execution_state: 'ACTIVE' | 'PAUSED';
        fresh: boolean;
        health_state: 'DOWN' | 'SUSPECT' | 'UNKNOWN' | 'UP';
        incident_id: string | null;
        last_checked_at: Date | null;
        last_response_time_ms: number | null;
        maintenance_active: boolean;
        state_version: string;
      }>(
        `SELECT check_row.execution_state,
                state.freshness_state = 'FRESH'
                  AND state.fresh_until > statement_timestamp() AS fresh,
                state.health_state, state.last_response_time_ms,
                state.last_accepted_run_finished_at AS last_checked_at,
                state.open_incident_id AS incident_id,
                state.state_version::text,
                app.effective_maintenance_until(
                  check_row.owner_id, check_row.id, statement_timestamp()
                ) IS NOT NULL AS maintenance_active
         FROM app.checks AS check_row
         JOIN monitoring.check_current_states AS state
           ON state.owner_id = check_row.owner_id AND state.check_id = check_row.id
         WHERE check_row.owner_id = $1 AND check_row.id = $2
           AND check_row.lifecycle_state = 'LIVE'`,
        [wakeup.owner_id, wakeup.aggregate_id],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      const fresh = row.execution_state === 'ACTIVE' && row.fresh;
      return event(wakeup, {
        event_type: 'check.status_changed',
        payload: {
          execution_state: row.execution_state,
          freshness_state: fresh ? 'FRESH' : 'STALE',
          health_state: fresh ? row.health_state : 'UNKNOWN',
          incident_id: row.incident_id,
          last_checked_at: row.last_checked_at?.toISOString() ?? null,
          last_response_time_ms: row.last_response_time_ms,
          maintenance_active: row.maintenance_active,
        },
        resource: {
          id: wakeup.aggregate_id,
          type: 'check_status',
          version: row.state_version,
        },
      });
    });
  }

  async #incident(wakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined> {
    return withUserTransaction(this.#pool, wakeup.owner_id, async (client) => {
      const result = await client.query<{
        check_id: string;
        closed_at: Date | null;
        resource_version: string;
        started_at: Date;
        status: 'CLOSED' | 'OPEN';
      }>(
        `SELECT check_id, status, started_at, closed_at, resource_version::text
         FROM monitoring.incidents
         WHERE owner_id = $1 AND id = $2`,
        [wakeup.owner_id, wakeup.aggregate_id],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      return event(wakeup, {
        event_type: 'incident.changed',
        payload: {
          check_id: row.check_id,
          ended_at: row.closed_at?.toISOString() ?? null,
          started_at: row.started_at.toISOString(),
          status: row.status,
        },
        resource: {
          id: wakeup.aggregate_id,
          type: 'incident',
          version: row.resource_version,
        },
      });
    });
  }

  async #maintenance(wakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined> {
    return withUserTransaction(this.#pool, wakeup.owner_id, async (client) => {
      const result = await client.query<{
        ends_at: Date;
        resource_version: string;
        starts_at: Date;
        state: 'CANCELLED' | 'SCHEDULED';
        target_id: string;
        target_type: 'CHECK' | 'GROUP';
      }>(
        `SELECT resource_version::text, state, starts_at, ends_at,
                CASE WHEN check_id IS NOT NULL THEN 'CHECK' ELSE 'GROUP' END AS target_type,
                COALESCE(check_id, group_id) AS target_id
         FROM app.maintenance_windows
         WHERE owner_id = $1 AND id = $2`,
        [wakeup.owner_id, wakeup.aggregate_id],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      return event(wakeup, {
        event_type: 'maintenance.changed',
        payload: {
          ends_at: row.ends_at.toISOString(),
          starts_at: row.starts_at.toISOString(),
          state: row.state,
          target_id: row.target_id,
          target_type: row.target_type,
        },
        resource: {
          id: wakeup.aggregate_id,
          type: 'maintenance_window',
          version: row.resource_version,
        },
      });
    });
  }

  async #notification(wakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined> {
    return withUserTransaction(this.#pool, wakeup.owner_id, async (client) => {
      if (wakeup.aggregate_type === 'notification_recipient') {
        const result = await client.query<{ resource_version: string; status: string }>(
          `SELECT resource_version::text, status FROM notification.recipients
           WHERE owner_id = $1 AND id = $2`,
          [wakeup.owner_id, wakeup.aggregate_id],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        return event(wakeup, {
          event_type: 'notification.changed',
          payload: { kind: 'RECIPIENT', state: row.status },
          resource: {
            id: wakeup.aggregate_id,
            type: 'notification_recipient',
            version: row.resource_version,
          },
        });
      }
      if (wakeup.aggregate_type === 'notification_policy') {
        const result = await client.query<{ mode: string; resource_version: string }>(
          `SELECT resource_version::text, mode FROM notification.policies
           WHERE owner_id = $1 AND id = $2`,
          [wakeup.owner_id, wakeup.aggregate_id],
        );
        const row = result.rows[0];
        if (!row) return undefined;
        return event(wakeup, {
          event_type: 'notification.changed',
          payload: { kind: 'POLICY', state: row.mode },
          resource: {
            id: wakeup.aggregate_id,
            type: 'notification_policy',
            version: row.resource_version,
          },
        });
      }
      const result = await client.query<{ state: string }>(
        `SELECT state FROM notification.deliveries
         WHERE owner_id = $1 AND id = $2`,
        [wakeup.owner_id, wakeup.aggregate_id],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      return event(wakeup, {
        event_type: 'notification.changed',
        payload: { kind: 'DELIVERY', state: row.state },
        resource: {
          id: wakeup.aggregate_id,
          type: 'notification_delivery',
          version: wakeup.aggregate_version,
        },
      });
    });
  }

  async #publicPage(wakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined> {
    return withUserTransaction(this.#pool, wakeup.owner_id, async (client) => {
      const result = await client.query<{ resource_version: string; state: string }>(
        `SELECT resource_version::text, state FROM public_status.pages
         WHERE owner_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [wakeup.owner_id, wakeup.aggregate_id],
      );
      const row = result.rows[0];
      if (!row) return undefined;
      return event(wakeup, {
        event_type: 'public_page.changed',
        payload: { page_revision: row.resource_version, state: row.state },
        resource: {
          id: wakeup.aggregate_id,
          type: 'public_status_page',
          version: row.resource_version,
        },
      });
    });
  }

  async #prediction(wakeup: InternalRealtimeWakeup): Promise<PrivateRealtimeEvent | undefined> {
    return withUserTransaction(this.#pool, wakeup.owner_id, async (client) => {
      const result = await client.query<{
        check_id: string;
        risk_level: string;
        valid_until: Date;
      }>(
        `SELECT check_id, risk_level, valid_until
         FROM prediction.scores
         WHERE owner_id = $1 AND check_id = $2
         ORDER BY computed_at DESC, id DESC LIMIT 1`,
        [wakeup.owner_id, wakeup.aggregate_id],
      );
      const row = result.rows[0];
      return event(wakeup, {
        event_type: 'prediction.changed',
        payload: {
          check_id: wakeup.aggregate_id,
          risk_level: row?.risk_level ?? null,
          status: row ? 'AVAILABLE' : 'EXPIRED',
          valid_until: row?.valid_until.toISOString() ?? null,
        },
        resource: {
          id: wakeup.aggregate_id,
          type: 'prediction_score',
          version: wakeup.aggregate_version,
        },
      });
    });
  }
}

export function projectionQueueKey(wakeup: InternalRealtimeWakeup): string {
  const family = wakeup.event_type.split('.', 1)[0] ?? 'unknown';
  return `${wakeup.owner_id}:${family}:${wakeup.aggregate_id}`;
}

interface ProjectionHubPort {
  publish(ownerId: string, event: PrivateRealtimeEvent): void;
  resyncOwner(ownerId: string, reason: 'PROJECTION_INVALIDATED'): void;
}

export class RealtimeProjectionCoordinator {
  readonly #activeKeys = new Set<string>();
  readonly #concurrency: number;
  readonly #hub: ProjectionHubPort;
  readonly #limit: number;
  readonly #pending = new Map<string, InternalRealtimeWakeup>();
  readonly #projector: RealtimeProjectionPort;
  #active = 0;

  constructor(input: {
    concurrency: number;
    hub: ProjectionHubPort;
    limit: number;
    projector: RealtimeProjectionPort;
  }) {
    this.#concurrency = input.concurrency;
    this.#hub = input.hub;
    this.#limit = input.limit;
    this.#projector = input.projector;
  }

  enqueue(rawWakeup: unknown): void {
    const parsed = internalRealtimeWakeupSchema.safeParse(rawWakeup);
    if (!parsed.success) throw new Error('Invalid realtime wakeup payload.');
    const wakeup = parsed.data;
    const key = projectionQueueKey(wakeup);
    const existing = this.#pending.get(key);
    if (existing) {
      if (
        wakeup.aggregate_version === null ||
        existing.aggregate_version === null ||
        BigInt(wakeup.aggregate_version) >= BigInt(existing.aggregate_version)
      ) {
        this.#pending.set(key, wakeup);
      }
      return;
    }
    if (this.#pending.size >= this.#limit) {
      this.#hub.resyncOwner(wakeup.owner_id, 'PROJECTION_INVALIDATED');
      return;
    }
    this.#pending.set(key, wakeup);
    this.#pump();
  }

  #pump(): void {
    while (this.#active < this.#concurrency && this.#pending.size > 0) {
      const item = [...this.#pending.entries()].find(([key]) => !this.#activeKeys.has(key));
      if (!item) return;
      const [key, wakeup] = item;
      this.#pending.delete(key);
      this.#active += 1;
      this.#activeKeys.add(key);
      void this.#projector
        .project(wakeup)
        .then((projected) => {
          if (projected) this.#hub.publish(wakeup.owner_id, projected);
        })
        .catch(() => this.#hub.resyncOwner(wakeup.owner_id, 'PROJECTION_INVALIDATED'))
        .finally(() => {
          this.#active -= 1;
          this.#activeKeys.delete(key);
          this.#pump();
        });
    }
  }
}

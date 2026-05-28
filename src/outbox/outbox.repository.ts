import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { IDomainEvent } from '@common/interfaces';

export interface OutboxRow {
  id: string;
  event_name: string;
  aggregate_id: string;
  payload: IDomainEvent<unknown> & { occurredAt: string };
}

@Injectable()
export class OutboxRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Writes the event row in the CALLER-SUPPLIED transaction so it commits
  // atomically with the state-transition row. Returns the new row id so the
  // happy path can retire it immediately after emit.
  async writeInTransaction(
    em: EntityManager,
    eventName: string,
    event: IDomainEvent<unknown>,
  ): Promise<string> {
    const rows = await em.query<{ id: string }[]>(
      `INSERT INTO outbox_events (id, event_name, aggregate_id, payload, status)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb, 'PENDING')
       RETURNING id`,
      [eventName, event.aggregateId, JSON.stringify(event)],
    );
    return rows[0].id;
  }

  async markDispatched(id: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE outbox_events
          SET status = 'DISPATCHED', dispatched_at = NOW()
        WHERE id = $1 AND status = 'PENDING'`,
      [id],
    );
  }

  // Crash-recovery candidates only: rows still PENDING AND older than a grace
  // window, so the sweep can never race an in-flight happy-path mark (which
  // completes in milliseconds). A row this old means the process died between
  // the transition COMMIT and the emit/mark.
  async fetchStuckPending(limit: number, graceSeconds = 10): Promise<OutboxRow[]> {
    return this.dataSource.query<OutboxRow[]>(
      `SELECT id, event_name, aggregate_id, payload
         FROM outbox_events
        WHERE status = 'PENDING'
          AND created_at < NOW() - ($2 || ' seconds')::interval
        ORDER BY created_at ASC
        LIMIT $1`,
      [limit, graceSeconds],
    );
  }
}

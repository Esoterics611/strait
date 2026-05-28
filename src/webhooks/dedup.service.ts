import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BusinessLogger } from '@common/logging';

@Injectable()
export class WebhookDeduplicationService {
  private readonly blog = new BusinessLogger('WebhookDeduplicationService');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async isProcessed(provider: string, eventId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ exists: boolean }[]>(
      `SELECT 1 FROM processed_webhooks WHERE provider = $1 AND event_id = $2`,
      [provider, eventId],
    );
    return rows.length > 0;
  }

  // Returns true if this is the first time (row was inserted), false if already processed.
  // ON CONFLICT DO NOTHING serializes concurrent callers — exactly one returns true.
  // rawBody (optional) is persisted to enable admin webhook replay (Session 8.5).
  async markProcessed(
    provider: string,
    eventId: string,
    rawBody?: Buffer,
  ): Promise<boolean> {
    const result: { rowCount: number } = await this.dataSource.query(
      `INSERT INTO processed_webhooks(id, provider, event_id, processed_at, raw_body)
       VALUES(gen_random_uuid(), $1, $2, NOW(), $3)
       ON CONFLICT DO NOTHING`,
      [provider, eventId, rawBody ?? null],
    );
    const first = (result.rowCount ?? 0) > 0;
    if (first) {
      this.blog.debug('markProcessed', {
        detail: { provider, eventId, outcome: 'first' },
      });
    } else {
      this.blog.info('markProcessed', {
        detail: { provider, eventId, outcome: 'duplicate_webhook_ignored' },
      });
    }
    return first;
  }
}

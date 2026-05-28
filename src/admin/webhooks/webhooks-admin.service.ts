import {
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { BusinessLogger } from '@common/logging';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { ISecretProvider, SECRET_PROVIDER } from '../../secrets/secret-provider.interface';
import { AppConfig } from '../../config/app-config.interface';
import { AuditLogRepository } from '../audit/audit-log.repository';

export type WebhookProvider = 'BRIDGE' | 'MESH' | 'RAPYD' | 'BOG';

export interface ProcessedWebhookRow {
  id: string;
  provider: WebhookProvider;
  event_id: string;
  processed_at: Date;
  raw_body: Buffer | null;
}

export interface FailedWebhookRow {
  id: string;
  provider: WebhookProvider;
  event_id: string;
  raw_body: Buffer;
  error_message: string | null;
  retry_count: number;
  created_at: Date;
  last_attempted_at: Date | null;
}

@Injectable()
export class WebhooksAdminService {
  private readonly blog = new BusinessLogger('WebhooksAdminService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider,
    private readonly config: ConfigService,
    private readonly audit: AuditLogRepository,
  ) {}

  async listProcessed(filters: { provider?: WebhookProvider; limit?: number; offset?: number } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.provider) { where.push(`provider = $${i++}`); params.push(filters.provider); }
    const limit = Math.min(filters.limit ?? 100, 500);
    const offset = filters.offset ?? 0;
    params.push(limit, offset);
    return this.dataSource.query(
      `SELECT id, provider, event_id, processed_at,
              (raw_body IS NOT NULL) AS replayable
         FROM processed_webhooks
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY processed_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
      params,
    );
  }

  async listFailed(): Promise<Omit<FailedWebhookRow, 'raw_body'>[]> {
    return this.dataSource.query(
      `SELECT id, provider, event_id, error_message, retry_count, created_at, last_attempted_at
         FROM failed_webhooks
         ORDER BY last_attempted_at DESC NULLS LAST, created_at DESC
         LIMIT 500`,
    );
  }

  async failedDetail(id: string) {
    const rows = await this.dataSource.query<FailedWebhookRow[]>(
      `SELECT * FROM failed_webhooks WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Failed webhook not found');
    return rows[0];
  }

  /** 24h / 7d / 30d failed counts per provider. */
  async stats() {
    return this.dataSource.query(
      `SELECT provider,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')  AS d1,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS d7,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') AS d30
         FROM failed_webhooks GROUP BY provider`,
    );
  }

  /**
   * Replay a processed webhook by POSTing its raw body through the original
   * provider's controller with a fresh signature. Used for ops recovery.
   */
  async replayProcessed(id: string, operatorId: string): Promise<{ status: number }> {
    const rows = await this.dataSource.query<ProcessedWebhookRow[]>(
      `SELECT * FROM processed_webhooks WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Webhook not found');
    const w = rows[0];
    if (!w.raw_body) {
      throw new HttpException('Webhook has no persisted raw body — cannot replay', 410);
    }

    // Delete the dedup row so the original handler accepts the replay; ops MUST
    // know this re-runs side effects. Audit logged.
    await this.dataSource.query(`DELETE FROM processed_webhooks WHERE id = $1`, [id]);

    const result = await this.deliver(w.provider, w.raw_body);
    await this.audit.write({
      operatorId,
      action: 'webhook.replay',
      targetType: 'webhook',
      targetId: id,
      metadata: { provider: w.provider, event_id: w.event_id, status: result.status },
    });
    return result;
  }

  async replayFailed(id: string, operatorId: string): Promise<{ status: number }> {
    const w = await this.failedDetail(id);
    const result = await this.deliver(w.provider, w.raw_body);
    await this.dataSource.query(
      `UPDATE failed_webhooks SET retry_count = retry_count + 1, last_attempted_at = NOW()
         WHERE id = $1`,
      [id],
    );
    if (result.status < 400) {
      await this.dataSource.query(`DELETE FROM failed_webhooks WHERE id = $1`, [id]);
    }
    await this.audit.write({
      operatorId,
      action: 'webhook.replay_failed',
      targetType: 'webhook',
      targetId: id,
      metadata: { provider: w.provider, event_id: w.event_id, status: result.status },
    });
    return result;
  }

  async bulkReplayFailed(
    from: Date,
    to: Date,
    operatorId: string,
  ): Promise<{ attempted: number; succeeded: number }> {
    const rows = await this.dataSource.query<FailedWebhookRow[]>(
      `SELECT * FROM failed_webhooks WHERE created_at BETWEEN $1 AND $2`,
      [from, to],
    );
    let succeeded = 0;
    for (const w of rows) {
      try {
        const r = await this.deliver(w.provider, w.raw_body);
        if (r.status < 400) {
          succeeded++;
          await this.dataSource.query(`DELETE FROM failed_webhooks WHERE id = $1`, [w.id]);
        }
      } catch (err) {
        this.blog.error('bulkReplay', {
          detail: { webhookId: w.id, provider: w.provider },
          error: err,
        });
      }
    }
    await this.audit.write({
      operatorId,
      action: 'webhook.bulk_replay',
      targetType: 'webhook',
      metadata: { from, to, attempted: rows.length, succeeded },
    });
    return { attempted: rows.length, succeeded };
  }

  async deleteFailed(id: string, operatorId: string): Promise<void> {
    const res = await this.dataSource.query<{ id: string }[]>(
      `DELETE FROM failed_webhooks WHERE id = $1 RETURNING id`,
      [id],
    );
    if (res.length === 0) throw new NotFoundException('Failed webhook not found');
    await this.audit.write({
      operatorId,
      action: 'webhook.delete_failed',
      targetType: 'webhook',
      targetId: id,
    });
  }

  /** Build a fresh signature and POST the raw body through our own webhook route. */
  private async deliver(
    provider: WebhookProvider,
    rawBody: Buffer,
  ): Promise<{ status: number }> {
    const base = this.config.get<string>('app.webhookBaseUrl') ?? '';
    if (!base) throw new Error('WEBHOOK_BASE_URL is not configured');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    let path: string;

    switch (provider) {
      case 'BRIDGE': {
        const secret = await this.secrets.get('BRIDGE_WEBHOOK_SECRET');
        headers['bridge-signature'] = createHmac('sha256', secret).update(rawBody).digest('hex');
        path = '/webhooks/bridge';
        break;
      }
      case 'MESH': {
        const secret = await this.secrets.get('MESH_WEBHOOK_SECRET');
        headers['mesh-signature'] = createHmac('sha256', secret).update(rawBody).digest('hex');
        path = '/webhooks/mesh';
        break;
      }
      case 'RAPYD': {
        // Rapyd signing depends on method+path+salt+ts+body; we re-sign with a fresh salt/ts.
        const secret = await this.secrets.get('RAPYD_SECRET_KEY');
        const accessKey = await this.secrets.get('RAPYD_ACCESS_KEY');
        const salt = Math.random().toString(36).slice(2, 18);
        const ts = String(Math.floor(Date.now() / 1000));
        const method = 'post';
        path = '/webhooks/rapyd';
        const toSign = `${method}${path}${salt}${ts}${accessKey}${secret}${rawBody.toString('utf8')}`;
        const hex = createHmac('sha256', secret).update(toSign).digest('hex');
        const sig = Buffer.from(hex).toString('base64');
        headers['rapyd-salt'] = salt;
        headers['rapyd-timestamp'] = ts;
        headers['rapyd-signature'] = sig;
        headers['access_key'] = accessKey;
        break;
      }
      case 'BOG': {
        const secret = await this.secrets.get('BOG_WEBHOOK_SECRET');
        headers['bog-signature'] = createHmac('sha256', secret).update(rawBody).digest('hex');
        path = '/webhooks/bog';
        break;
      }
    }

    try {
      const res = await axios.post(`${base}${path}`, rawBody, {
        headers,
        validateStatus: () => true,
        transformRequest: [(d) => d],
      });
      return { status: res.status };
    } catch (err) {
      const ax = err as AxiosError;
      return { status: ax.response?.status ?? 502 };
    }
  }
}

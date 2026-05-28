import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BusinessLogger } from '@common/logging';

export type ProviderName = 'BRIDGE' | 'RAPYD' | 'MESH' | 'BOG';

/**
 * Records every outbound provider API call so the Settings → Providers view can
 * show last success / last error / latency per provider without grepping logs.
 *
 * Real API clients call `instrument(provider, fn)` around their axios call.
 * Best-effort writes — never crash the call path.
 */
@Injectable()
export class ProviderHealthService {
  private readonly blog = new BusinessLogger('ProviderHealthService');

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async instrument<T>(provider: ProviderName, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const elapsed = Date.now() - start;
      await this.recordSuccess(provider, elapsed);
      return result;
    } catch (err) {
      await this.recordFailure(provider, (err as Error).message);
      throw err;
    }
  }

  async recordSuccess(provider: ProviderName, latencyMs: number): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO provider_health(provider, last_success_at, last_latency_ms)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (provider) DO UPDATE
           SET last_success_at = NOW(), last_latency_ms = EXCLUDED.last_latency_ms`,
        [provider, latencyMs],
      );
    } catch (err) {
      this.blog.warn('providerHealthUpsert', {
        detail: { provider },
        error: err,
      });
    }
  }

  async recordFailure(provider: ProviderName, errorMessage: string): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO provider_health(provider, last_error_at, last_error_message)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (provider) DO UPDATE
           SET last_error_at = NOW(), last_error_message = EXCLUDED.last_error_message`,
        [provider, errorMessage.slice(0, 1000)],
      );
    } catch (err) {
      this.blog.warn('providerHealthUpsert', {
        detail: { provider },
        error: err,
      });
    }
  }
}

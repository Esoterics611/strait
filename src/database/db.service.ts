import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BusinessLogger } from '@common/logging';

const PG_SERIALIZATION_FAILURE = '40001';
const SLOW_TX_MS = 500;

@Injectable()
export class DbService {
  private readonly blog = new BusinessLogger('DbService');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // Runs fn inside a SERIALIZABLE transaction, retrying once on PostgreSQL
  // serialization_failure (SQLSTATE 40001) before propagating.
  async runInSerializableTransaction<T>(
    fn: (em: EntityManager) => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    const caller = this.callerHint();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await this.dataSource.transaction('SERIALIZABLE', fn);
        const durationMs = Date.now() - startedAt;
        if (durationMs > SLOW_TX_MS) {
          this.blog.warn('runInSerializableTransaction', {
            detail: { outcome: 'slow_transaction', caller },
            durationMs,
          });
        }
        return result;
      } catch (err: unknown) {
        const code =
          (err as { code?: string })?.code ??
          (err as { driverError?: { code?: string } })?.driverError?.code;
        if (code === PG_SERIALIZATION_FAILURE && attempt === 0) {
          this.blog.warn('runInSerializableTransaction', {
            detail: {
              outcome: 'serialization_failure_retry',
              attempt: attempt + 1,
              caller,
            },
          });
          continue;
        }
        if (code === PG_SERIALIZATION_FAILURE) {
          this.blog.error('runInSerializableTransaction', {
            detail: { outcome: 'serialization_failure_exhausted', caller },
            error: err,
            durationMs: Date.now() - startedAt,
          });
        }
        throw err;
      }
    }
    // unreachable — loop always returns or throws
    throw new Error('unexpected runInSerializableTransaction exit');
  }

  /** Best-effort: the first call-site frame outside DbService, for log context. */
  private callerHint(): string | undefined {
    const stack = new Error().stack;
    if (!stack) return undefined;
    for (const line of stack.split('\n').slice(1)) {
      if (
        !line.includes('db.service') &&
        !line.includes('DbService') &&
        !line.includes('node:') &&
        !line.includes('node_modules')
      ) {
        return line.trim().replace(/^at\s+/, '');
      }
    }
    return undefined;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BusinessLogger } from '@common/logging';

/**
 * Records every cron tick into the cron_runs table so the Settings UI can show
 * last-fired + last status + last error per cron. Wrap a cron's main method:
 *
 *   await this.runs.wrap('stale_dispatch', () => this.work());
 *
 * The wrapper is non-throwing on the LOG side — if the cron_runs INSERT fails,
 * we surface the cron's error (the cron always wins). Both rows-not-found-on-
 * upsert and write-failed-on-flush cases are tolerated.
 */
@Injectable()
export class CronRunLogger {
  private readonly blog = new BusinessLogger('CronRunLogger');

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async wrap<T>(name: string, fn: () => Promise<T>): Promise<T> {
    try {
      const result = await fn();
      await this.recordSuccess(name);
      return result;
    } catch (err) {
      await this.recordFailure(name, (err as Error).message);
      throw err;
    }
  }

  async recordSuccess(name: string): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO cron_runs(cron_name, last_fired_at, last_status, last_error)
         VALUES ($1, NOW(), 'OK', NULL)
         ON CONFLICT (cron_name) DO UPDATE
           SET last_fired_at = NOW(), last_status = 'OK', last_error = NULL`,
        [name],
      );
    } catch (err) {
      this.blog.warn('cronRunUpsert', {
        detail: { cron: name },
        error: err,
      });
    }
  }

  async recordFailure(name: string, errorMessage: string): Promise<void> {
    try {
      await this.ds.query(
        `INSERT INTO cron_runs(cron_name, last_fired_at, last_status, last_error)
         VALUES ($1, NOW(), 'FAIL', $2)
         ON CONFLICT (cron_name) DO UPDATE
           SET last_fired_at = NOW(), last_status = 'FAIL', last_error = $2`,
        [name, errorMessage.slice(0, 1000)],
      );
    } catch (err) {
      this.blog.warn('cronRunUpsert', {
        detail: { cron: name },
        error: err,
      });
    }
  }
}

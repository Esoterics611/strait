import { HttpException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { MemberFrozenError } from '@common/errors';

/**
 * Single source of truth for the is_frozen check. Path A/B/C entry points
 * call this BEFORE any INSERT or external API call. Returns HTTP 423 to the
 * caller via the path controllers; service-layer throws a domain error.
 */
@Injectable()
export class MemberFreezeChecker {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async assertNotFrozen(memberId: string): Promise<void> {
    const rows = await this.dataSource.query<{ is_frozen: boolean }[]>(
      `SELECT is_frozen FROM member_accounts WHERE member_id = $1`,
      [memberId],
    );
    if (rows.length === 0) return; // unknown member — defer to caller validation
    if (rows[0].is_frozen) throw new MemberFrozenError(memberId);
  }

  async assertNotFrozenInTransaction(em: EntityManager, memberId: string): Promise<void> {
    const rows = await em.query<{ is_frozen: boolean }[]>(
      `SELECT is_frozen FROM member_accounts WHERE member_id = $1 FOR SHARE`,
      [memberId],
    );
    if (rows.length === 0) return;
    if (rows[0].is_frozen) throw new MemberFrozenError(memberId);
  }
}

/** Wrap a domain exception in HTTP 423 for controller boundaries. */
export function rethrowFrozenAs423(err: unknown): never {
  if (err instanceof MemberFrozenError) {
    throw new HttpException(
      { message: err.message, code: 'MEMBER_FROZEN' },
      423,
    );
  }
  throw err as Error;
}

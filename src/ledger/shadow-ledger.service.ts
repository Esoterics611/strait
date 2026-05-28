import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BusinessLogger } from '@common/logging';
import { DbService } from '../database/db.service';
import { DomainEventEmitterService, PAYMENT_EVENTS } from '../events/domain-event-emitter.service';
import { SourceType, Direction, TxState } from '@common/enums';
import { InsufficientBalanceError } from '@common/errors';
import { IDomainEvent } from '@common/interfaces';
import { randomUUID } from 'crypto';

@Injectable()
export class ShadowLedgerService {
  private readonly blog = new BusinessLogger('ShadowLedger');

  constructor(
    private readonly dbService: DbService,
    private readonly events: DomainEventEmitterService,
  ) {}

  async creditUsdc(
    memberId: string,
    amountUnits: bigint,
    sourceType: SourceType,
    sourceReferenceId: string,
    idempotencyKey: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    let txId: string;

    await this.dbService.runInSerializableTransaction(async (em: EntityManager) => {
      txId = await this.creditUsdcInTransaction(
        em,
        memberId,
        amountUnits,
        sourceType,
        idempotencyKey,
      );
    });

    const event: IDomainEvent<{ txId: string; memberId: string; amountUnits: string; sourceType: SourceType; metadata?: Record<string, unknown> }> = {
      eventId: randomUUID(),
      occurredAt: new Date(),
      aggregateId: txId!,
      aggregateType: 'UsdcTransaction',
      eventType: PAYMENT_EVENTS.USDC_CREDITED,
      payload: { txId: txId!, memberId, amountUnits: amountUnits.toString(), sourceType, metadata },
    };
    this.events.emit(PAYMENT_EVENTS.USDC_CREDITED, event);
    return txId!;
  }

  /**
   * Credits USDC while participating in a caller-supplied SERIALIZABLE transaction.
   * Used by Path C so the pool debit and the member credit commit atomically.
   * Returns the new usdc_transactions.tx_id (or the existing one if idempotency
   * shortcut fires).
   */
  async creditUsdcInTransaction(
    em: EntityManager,
    memberId: string,
    amountUnits: bigint,
    sourceType: SourceType,
    idempotencyKey: string,
  ): Promise<string> {
    const startedAt = Date.now();
    const existing = await em.query<{ tx_id: string }[]>(
      `SELECT tx_id FROM usdc_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing.length > 0) {
      this.blog.info('creditUsdc', {
        txId: existing[0].tx_id,
        memberId,
        sourceType,
        detail: { idempotencyKey, outcome: 'duplicate_credit_skipped' },
      });
      return existing[0].tx_id;
    }

    const members = await em.query<{ usdc_virtual_balance_wei: string }[]>(
      `SELECT usdc_virtual_balance_wei FROM member_accounts WHERE member_id = $1 FOR UPDATE`,
      [memberId],
    );
    if (members.length === 0) throw new Error(`Member not found: ${memberId}`);

    const newBalance = BigInt(members[0].usdc_virtual_balance_wei) + amountUnits;

    const rows = await em.query<{ tx_id: string }[]>(
      `INSERT INTO usdc_transactions
         (tx_id, member_id, source_type, direction, amount_usdc_wei, state, idempotency_key)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
       RETURNING tx_id`,
      [
        memberId,
        sourceType,
        Direction.CREDIT,
        amountUnits.toString(),
        TxState.USDC_LOCKED,
        idempotencyKey,
      ],
    );

    await em.query(
      `UPDATE member_accounts SET usdc_virtual_balance_wei = $1, updated_at = NOW()
       WHERE member_id = $2`,
      [newBalance.toString(), memberId],
    );

    this.blog.info('creditUsdc', {
      txId: rows[0].tx_id,
      memberId,
      sourceType,
      detail: {
        amountUnits: amountUnits.toString(),
        newBalance: newBalance.toString(),
      },
      durationMs: Date.now() - startedAt,
    });
    return rows[0].tx_id;
  }

  async debitUsdc(
    memberId: string,
    amountUnits: bigint,
    txId: string,
    idempotencyKey: string,
  ): Promise<string> {
    let debitTxId: string;
    let previousBalance: bigint;
    let resultingBalance: bigint;
    const startedAt = Date.now();

    await this.dbService.runInSerializableTransaction(async (em: EntityManager) => {
      const members = await em.query<{ usdc_virtual_balance_wei: string }[]>(
        `SELECT usdc_virtual_balance_wei FROM member_accounts WHERE member_id = $1 FOR UPDATE`,
        [memberId],
      );
      if (members.length === 0) throw new Error(`Member not found: ${memberId}`);

      const currentBalance = BigInt(members[0].usdc_virtual_balance_wei);
      previousBalance = currentBalance;

      // Throw before touching the DB if the debit would violate the balance constraint.
      if (currentBalance < amountUnits) {
        this.blog.error('debitUsdc', {
          txId,
          memberId,
          detail: {
            required: amountUnits.toString(),
            available: currentBalance.toString(),
          },
        });
        throw new InsufficientBalanceError(memberId, amountUnits, currentBalance);
      }

      const newBalance = currentBalance - amountUnits;
      resultingBalance = newBalance;

      const rows = await em.query<{ tx_id: string }[]>(
        `INSERT INTO usdc_transactions
           (tx_id, member_id, source_type, direction, amount_usdc_wei, state, idempotency_key)
         VALUES
           (gen_random_uuid(), $1, 'MESH', $2, $3, $4, $5)
         RETURNING tx_id`,
        [
          memberId,
          Direction.DEBIT,
          amountUnits.toString(),
          TxState.BRIDGE_DISPATCHED,
          idempotencyKey,
        ],
      );
      debitTxId = rows[0].tx_id;

      await em.query(
        `UPDATE member_accounts SET usdc_virtual_balance_wei = $1, updated_at = NOW()
         WHERE member_id = $2`,
        [newBalance.toString(), memberId],
      );
    });

    const event: IDomainEvent<{ txId: string; debitTxId: string; memberId: string; amountUnits: string }> = {
      eventId: randomUUID(),
      occurredAt: new Date(),
      aggregateId: txId,
      aggregateType: 'UsdcTransaction',
      eventType: PAYMENT_EVENTS.USDC_DEBITED,
      payload: { txId, debitTxId: debitTxId!, memberId, amountUnits: amountUnits.toString() },
    };
    this.blog.info('debitUsdc', {
      txId,
      memberId,
      detail: {
        debitTxId: debitTxId!,
        amountUnits: amountUnits.toString(),
        previousBalance: previousBalance!.toString(),
        newBalance: resultingBalance!.toString(),
      },
      durationMs: Date.now() - startedAt,
    });
    this.events.emit(PAYMENT_EVENTS.USDC_DEBITED, event);
    return debitTxId!;
  }

  async getBalance(memberId: string): Promise<bigint> {
    const rows = await this.dbService
      .runInSerializableTransaction(async (em) =>
        em.query<{ usdc_virtual_balance_wei: string }[]>(
          `SELECT usdc_virtual_balance_wei FROM member_accounts WHERE member_id = $1`,
          [memberId],
        ),
      );
    if (rows.length === 0) throw new Error(`Member not found: ${memberId}`);
    const balance = BigInt(rows[0].usdc_virtual_balance_wei);
    this.blog.debug('getBalance', {
      memberId,
      detail: { balance: balance.toString() },
    });
    return balance;
  }
}

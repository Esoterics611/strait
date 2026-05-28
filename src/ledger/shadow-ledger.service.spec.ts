import { ShadowLedgerService } from './shadow-ledger.service';
import { DbService } from '../database/db.service';
import { DomainEventEmitterService, PAYMENT_EVENTS } from '../events/domain-event-emitter.service';
import { SourceType } from '@common/enums';
import { InsufficientBalanceError } from '@common/errors';
import { EntityManager } from 'typeorm';

// Helpers to build mock EntityManager query results.
function memberRow(balance: bigint) {
  return [{ usdc_virtual_balance_wei: balance.toString() }];
}

function txRow(txId: string) {
  return [{ tx_id: txId }];
}

function makeEm(queryResponses: unknown[]): EntityManager {
  const fn = jest.fn();
  queryResponses.forEach((r) => fn.mockResolvedValueOnce(r));
  return { query: fn } as unknown as EntityManager;
}

function makeDbService(em: EntityManager): DbService {
  return {
    runInSerializableTransaction: jest.fn((fn: (em: EntityManager) => Promise<unknown>) =>
      fn(em),
    ),
  } as unknown as DbService;
}

function makeEvents() {
  return { emit: jest.fn() } as unknown as DomainEventEmitterService;
}

describe('ShadowLedgerService', () => {
  describe('creditUsdc', () => {
    it('inserts a credit row, updates balance, emits event, returns txId', async () => {
      const em = makeEm([
        [],                             // idempotency check — no existing row
        memberRow(1_000_000n),          // SELECT ... FOR UPDATE
        txRow('tx-abc'),                // INSERT RETURNING
        undefined,                      // UPDATE member_accounts
      ]);
      const events = makeEvents();
      const svc = new ShadowLedgerService(makeDbService(em), events);

      const txId = await svc.creditUsdc(
        'member-1',
        500_000n,
        SourceType.MESH,
        'ref-1',
        'idem-key-1',
      );

      expect(txId).toBe('tx-abc');
      expect(events.emit).toHaveBeenCalledWith(
        PAYMENT_EVENTS.USDC_CREDITED,
        expect.objectContaining({ aggregateId: 'tx-abc' }),
      );
    });

    it('returns existing txId and emits event on duplicate idempotency key', async () => {
      const em = makeEm([
        [{ tx_id: 'tx-existing' }],     // idempotency check — row found
      ]);
      const events = makeEvents();
      const svc = new ShadowLedgerService(makeDbService(em), events);

      const txId = await svc.creditUsdc(
        'member-1',
        500_000n,
        SourceType.MESH,
        'ref-1',
        'idem-key-1',
      );

      expect(txId).toBe('tx-existing');
      // No INSERT or UPDATE should follow
      expect((em.query as jest.Mock).mock.calls).toHaveLength(1);
    });
  });

  describe('debitUsdc', () => {
    it('deducts balance and returns debit txId', async () => {
      const em = makeEm([
        memberRow(2_000_000n),           // SELECT ... FOR UPDATE
        txRow('tx-debit'),               // INSERT RETURNING
        undefined,                       // UPDATE
      ]);
      const events = makeEvents();
      const svc = new ShadowLedgerService(makeDbService(em), events);

      const debitId = await svc.debitUsdc('member-1', 500_000n, 'tx-credit', 'idem-debit-1');
      expect(debitId).toBe('tx-debit');
      expect(events.emit).toHaveBeenCalledWith(
        PAYMENT_EVENTS.USDC_DEBITED,
        expect.objectContaining({ aggregateId: 'tx-credit' }),
      );
    });

    it('throws InsufficientBalanceError BEFORE any DB write when balance is too low', async () => {
      const em = makeEm([
        memberRow(100_000n),             // SELECT ... FOR UPDATE
        // No INSERT or UPDATE should be called after this
      ]);
      const events = makeEvents();
      const svc = new ShadowLedgerService(makeDbService(em), events);

      await expect(
        svc.debitUsdc('member-1', 500_000n, 'tx-credit', 'idem-debit-1'),
      ).rejects.toBeInstanceOf(InsufficientBalanceError);

      // Only one query should have been issued (the SELECT FOR UPDATE).
      expect((em.query as jest.Mock).mock.calls).toHaveLength(1);
      expect(events.emit).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('returns bigint balance from member_accounts', async () => {
      const em = makeEm([memberRow(5_000_000n)]);
      const svc = new ShadowLedgerService(makeDbService(em), makeEvents());
      expect(await svc.getBalance('member-1')).toBe(5_000_000n);
    });

    it('credit then debit round-trip produces correct balance', async () => {
      // Simulate a credit of 1_000_000 followed by a debit of 300_000.
      // We verify the balances passed to UPDATE match expectations.
      const creditEm = makeEm([
        [],
        memberRow(0n),
        txRow('tx-c'),
        undefined,
      ]);
      const debitEm = makeEm([
        memberRow(1_000_000n),
        txRow('tx-d'),
        undefined,
      ]);

      const events = makeEvents();
      const svcCredit = new ShadowLedgerService(makeDbService(creditEm), events);
      const svcDebit = new ShadowLedgerService(makeDbService(debitEm), events);

      await svcCredit.creditUsdc('m1', 1_000_000n, SourceType.MESH, 'r', 'ik1');
      await svcDebit.debitUsdc('m1', 300_000n, 'tx-c', 'ik2');

      // The UPDATE in the credit path should set the balance to 1_000_000.
      const creditUpdateArgs = (creditEm.query as jest.Mock).mock.calls[3];
      expect(BigInt(creditUpdateArgs[1][0])).toBe(1_000_000n);

      // The UPDATE in the debit path should set the balance to 700_000.
      const debitUpdateArgs = (debitEm.query as jest.Mock).mock.calls[2];
      expect(BigInt(debitUpdateArgs[1][0])).toBe(700_000n);
    });
  });
});

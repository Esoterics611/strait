import { StateMachineService } from './state-machine.service';
import { DomainEventEmitterService } from '../events/domain-event-emitter.service';
import { OutboxRepository } from '../outbox/outbox.repository';
import { TxState } from '@common/enums';
import { InvalidTransitionError, TransactionNotFoundError } from '@common/errors';
import { DataSource } from 'typeorm';

const TX_ID = 'tx-test-1';

// Build a mock DataSource where getCurrentState returns `state`, the
// transition INSERT succeeds, and the event-bearing path's atomic
// transaction(em => …) runs the callback against a mock EntityManager.
function makeDs(currentState: TxState | null): DataSource {
  const query = jest.fn().mockImplementation((sql: string) => {
    if (sql.includes('v_tx_current_state')) {
      return currentState !== null
        ? Promise.resolve([{ current_state: currentState }])
        : Promise.resolve([]);
    }
    if (sql.includes('usdc_transactions')) {
      return currentState !== null
        ? Promise.resolve([{ state: currentState }])
        : Promise.resolve([]);
    }
    // INSERT into tx_state_transitions (non-event path)
    return Promise.resolve(undefined);
  });
  return {
    query,
    transaction: jest.fn(
      async (cb: (em: { query: jest.Mock }) => Promise<unknown>) =>
        cb({ query: jest.fn().mockResolvedValue(undefined) }),
    ),
  } as unknown as DataSource;
}

function makeEvents() {
  return { emit: jest.fn() } as unknown as DomainEventEmitterService;
}

function makeOutbox() {
  return {
    writeInTransaction: jest.fn().mockResolvedValue('obx-1'),
    markDispatched: jest.fn().mockResolvedValue(undefined),
  } as unknown as OutboxRepository;
}

describe('StateMachineService', () => {
  describe('valid transitions', () => {
    const validCases: [TxState, TxState][] = [
      [TxState.MESH_PENDING,           TxState.USDC_LOCKED],
      [TxState.MESH_PENDING,           TxState.FAILED],
      [TxState.ILS_PENDING_ONRAMP,     TxState.ILS_SWAP_PROCESSING],
      [TxState.ILS_PENDING_ONRAMP,     TxState.FAILED],
      [TxState.ILS_SWAP_PROCESSING,    TxState.USDC_LOCKED],
      [TxState.ILS_SWAP_PROCESSING,    TxState.FAILED],
      [TxState.ILS_PENDING_COLLECTION, TxState.ILS_WIRE_CONFIRMED],
      [TxState.ILS_PENDING_COLLECTION, TxState.FAILED],
      [TxState.ILS_WIRE_CONFIRMED,     TxState.USDC_LOCKED],
      [TxState.ILS_WIRE_CONFIRMED,     TxState.FAILED],
      [TxState.USDC_LOCKED,            TxState.BRIDGE_DISPATCHED],
      [TxState.USDC_LOCKED,            TxState.FAILED_BRIDGE],
      [TxState.BRIDGE_DISPATCHED,      TxState.SETTLED_USD],
      [TxState.BRIDGE_DISPATCHED,      TxState.FAILED_BRIDGE],
      [TxState.FAILED,                 TxState.REFUND_QUEUED],
      [TxState.FAILED_BRIDGE,          TxState.REFUND_QUEUED],
      [TxState.REFUND_QUEUED,          TxState.REFUNDED],
    ];

    it.each(validCases)(
      '%s → %s succeeds',
      async (from, to) => {
        const svc = new StateMachineService(makeDs(from), makeEvents(), makeOutbox());
        await expect(svc.transition(TX_ID, to)).resolves.toBeUndefined();
      },
    );
  });

  describe('invalid transitions', () => {
    const invalidCases: [TxState, TxState][] = [
      [TxState.MESH_PENDING,      TxState.SETTLED_USD],
      [TxState.MESH_PENDING,      TxState.BRIDGE_DISPATCHED],
      [TxState.USDC_LOCKED,       TxState.MESH_PENDING],
      [TxState.BRIDGE_DISPATCHED, TxState.USDC_LOCKED],
      [TxState.FAILED,            TxState.USDC_LOCKED],
      [TxState.REFUNDED,          TxState.REFUND_QUEUED],
      [TxState.SETTLED_USD,       TxState.BRIDGE_DISPATCHED],
      [TxState.ILS_PENDING_ONRAMP, TxState.SETTLED_USD],
      [TxState.REFUND_QUEUED,     TxState.MESH_PENDING],
      [TxState.FAILED_BRIDGE,     TxState.SETTLED_USD],
    ];

    it.each(invalidCases)(
      '%s → %s throws InvalidTransitionError',
      async (from, to) => {
        const svc = new StateMachineService(makeDs(from), makeEvents(), makeOutbox());
        await expect(svc.transition(TX_ID, to)).rejects.toBeInstanceOf(
          InvalidTransitionError,
        );
      },
    );
  });

  describe('terminal states', () => {
    it('SETTLED_USD rejects any further transition', async () => {
      for (const next of Object.values(TxState)) {
        const svc = new StateMachineService(makeDs(TxState.SETTLED_USD), makeEvents(), makeOutbox());
        await expect(svc.transition(TX_ID, next)).rejects.toBeInstanceOf(
          InvalidTransitionError,
        );
      }
    });

    it('REFUNDED rejects any further transition', async () => {
      for (const next of Object.values(TxState)) {
        const svc = new StateMachineService(makeDs(TxState.REFUNDED), makeEvents(), makeOutbox());
        await expect(svc.transition(TX_ID, next)).rejects.toBeInstanceOf(
          InvalidTransitionError,
        );
      }
    });
  });

  describe('getCurrentState', () => {
    it('returns state from v_tx_current_state when a transition row exists', async () => {
      const svc = new StateMachineService(makeDs(TxState.USDC_LOCKED), makeEvents(), makeOutbox());
      expect(await svc.getCurrentState(TX_ID)).toBe(TxState.USDC_LOCKED);
    });

    it('falls back to usdc_transactions.state when no transition row yet', async () => {
      const ds = {
        query: jest.fn()
          .mockResolvedValueOnce([])                           // v_tx_current_state — empty
          .mockResolvedValueOnce([{ state: TxState.MESH_PENDING }]), // usdc_transactions
      } as unknown as DataSource;
      const svc = new StateMachineService(ds, makeEvents(), makeOutbox());
      expect(await svc.getCurrentState(TX_ID)).toBe(TxState.MESH_PENDING);
    });

    it('throws TransactionNotFoundError for unknown txId', async () => {
      const ds = {
        query: jest.fn()
          .mockResolvedValueOnce([])  // v_tx_current_state
          .mockResolvedValueOnce([]), // usdc_transactions
      } as unknown as DataSource;
      const svc = new StateMachineService(ds, makeEvents(), makeOutbox());
      await expect(svc.getCurrentState('unknown-tx')).rejects.toBeInstanceOf(
        TransactionNotFoundError,
      );
    });
  });
});

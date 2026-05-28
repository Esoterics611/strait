import { DevToolsService } from './dev-tools.service';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service';
import {
  DomainEventEmitterService,
  PAYMENT_EVENTS,
} from '../events/domain-event-emitter.service';
import { MeshService } from '../mesh/mesh.service';
import { SourceType, TxState } from '@common/enums';

function makeLedger(returnedTxId = 'tx-emit'): ShadowLedgerService {
  return {
    creditUsdc: jest.fn().mockResolvedValue(returnedTxId),
  } as unknown as ShadowLedgerService;
}

function makeEvents(): DomainEventEmitterService {
  return { emit: jest.fn() } as unknown as DomainEventEmitterService;
}

function makeMesh(): MeshService & {
  connectMember: jest.Mock;
  initiateTransfer: jest.Mock;
} {
  return {
    connectMember: jest
      .fn()
      .mockResolvedValue({ meshAccountId: 'mesh_acct_test' }),
    initiateTransfer: jest.fn().mockResolvedValue({
      txId: 'tx-mesh',
      correlationId: 'corr-1',
      meshTransferId: 'mesh_tr_1',
    }),
  } as unknown as MeshService & {
    connectMember: jest.Mock;
    initiateTransfer: jest.Mock;
  };
}

const MEMBER_ID = 'a0000000-0000-0000-0000-000000000001';

describe('DevToolsService.emitLocked', () => {
  it('credits via shadow ledger and emits payment.usdc_locked', async () => {
    const ledger = makeLedger('tx-emit-1');
    const events = makeEvents();
    const svc = new DevToolsService(ledger, events, makeMesh());

    const result = await svc.emitLocked(MEMBER_ID, 5_000_000n);

    expect(result).toEqual({ txId: 'tx-emit-1' });
    expect(ledger.creditUsdc).toHaveBeenCalledTimes(1);
    const args = (ledger.creditUsdc as jest.Mock).mock.calls[0];
    expect(args[0]).toBe(MEMBER_ID);
    expect(args[1]).toBe(5_000_000n);
    expect(args[2]).toBe(SourceType.MESH);
    expect(typeof args[3]).toBe('string'); // source reference id
    expect(args[4]).toMatch(/^dev-emit-/);  // idempotency key

    expect(events.emit).toHaveBeenCalledTimes(1);
    const [eventName, event] = (events.emit as jest.Mock).mock.calls[0];
    expect(eventName).toBe(PAYMENT_EVENTS.USDC_LOCKED);
    expect(event.aggregateId).toBe('tx-emit-1');
    expect(event.payload.toState).toBe(TxState.USDC_LOCKED);
  });

  it('rejects zero or negative amounts without touching the ledger', async () => {
    const ledger = makeLedger();
    const events = makeEvents();
    const svc = new DevToolsService(ledger, events, makeMesh());

    await expect(svc.emitLocked(MEMBER_ID, 0n)).rejects.toThrow(/positive/);
    await expect(svc.emitLocked(MEMBER_ID, -1n)).rejects.toThrow(/positive/);

    expect(ledger.creditUsdc).not.toHaveBeenCalled();
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('produces unique idempotency keys across calls', async () => {
    const ledger = makeLedger();
    const svc = new DevToolsService(ledger, makeEvents(), makeMesh());

    await svc.emitLocked(MEMBER_ID, 1n);
    await svc.emitLocked(MEMBER_ID, 1n);

    const calls = (ledger.creditUsdc as jest.Mock).mock.calls;
    expect(calls.length).toBe(2);
    expect(calls[0][4]).not.toBe(calls[1][4]);
  });
});

describe('DevToolsService.meshConnect', () => {
  it('forwards to MeshService.connectMember with a stub OAuth payload', async () => {
    const mesh = makeMesh();
    const svc = new DevToolsService(makeLedger(), makeEvents(), mesh);

    const result = await svc.meshConnect(MEMBER_ID);

    expect(result).toEqual({ meshAccountId: 'mesh_acct_test' });
    expect(mesh.connectMember).toHaveBeenCalledTimes(1);
    const [calledMemberId, calledAuth] = mesh.connectMember.mock.calls[0];
    expect(calledMemberId).toBe(MEMBER_ID);
    expect(calledAuth.authorizationCode).toBeTruthy();
    expect(calledAuth.codeVerifier).toBeTruthy();
    expect(calledAuth.redirectUri).toMatch(/mesh\/callback$/);
  });
});

describe('DevToolsService.meshInitiate', () => {
  it('forwards to MeshService.initiateTransfer and returns its result', async () => {
    const mesh = makeMesh();
    const svc = new DevToolsService(makeLedger(), makeEvents(), mesh);

    const result = await svc.meshInitiate(
      MEMBER_ID,
      1_000_000n,
      'b0000000-0000-0000-0000-000000000099',
    );

    expect(result).toEqual({
      txId: 'tx-mesh',
      correlationId: 'corr-1',
      meshTransferId: 'mesh_tr_1',
    });
    expect(mesh.initiateTransfer).toHaveBeenCalledWith(
      MEMBER_ID,
      1_000_000n,
      'b0000000-0000-0000-0000-000000000099',
    );
  });
});

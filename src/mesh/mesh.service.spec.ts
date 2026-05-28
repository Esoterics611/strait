import { MeshService } from './mesh.service';
import { BlockedAddressError } from './mesh.errors';
import { IMeshApiClient } from './mesh-api-client.interface';
import { IOFACScreener } from './ofac-screener.service';
import { DbService } from '../database/db.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { StateMachineService } from '../state-machine/state-machine.service';
import {
  DomainEventEmitterService,
  PAYMENT_EVENTS,
} from '../events/domain-event-emitter.service';
import { ISecretProvider } from '../secrets/secret-provider.interface';
import { TxState } from '@common/enums';
import { DataSource, EntityManager } from 'typeorm';

class StubSecretProvider implements ISecretProvider {
  constructor(private readonly map: Record<string, string>) {}
  async get(key: string): Promise<string> {
    const v = this.map[key];
    if (v === undefined) throw new Error(`Missing ${key}`);
    return v;
  }
  async set(key: string, value: string): Promise<void> {
    this.map[key] = value;
  }
}

function makeDataSource(responses: unknown[]): DataSource {
  const fn = jest.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  return { query: fn } as unknown as DataSource;
}

function makeEm(responses: unknown[]): EntityManager {
  const fn = jest.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  return { query: fn } as unknown as EntityManager;
}

function makeDb(em: EntityManager): DbService {
  return {
    runInSerializableTransaction: jest.fn(
      (fn: (em: EntityManager) => Promise<unknown>) => fn(em),
    ),
  } as unknown as DbService;
}

function makeOk(): IOFACScreener {
  return { screenAddress: jest.fn().mockResolvedValue({ blocked: false }) };
}

function makeBlocked(): IOFACScreener {
  return {
    screenAddress: jest
      .fn()
      .mockResolvedValue({ blocked: true, reason: 'static_blocklist' }),
  };
}

function makeMeshClient(): IMeshApiClient & {
  initiateTransfer: jest.Mock;
  connectMember: jest.Mock;
} {
  return {
    initiateTransfer: jest
      .fn()
      .mockResolvedValue({ meshTransferId: 'mesh_tr_xyz' }),
    connectMember: jest.fn().mockResolvedValue({
      meshAccountId: 'mesh_acct_test',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 999_999_999,
    }),
  } as unknown as IMeshApiClient & {
    initiateTransfer: jest.Mock;
    connectMember: jest.Mock;
  };
}

const MEMBER_ID = 'a0000000-0000-0000-0000-000000000001';
const LIQUID_ADDRESS = '0xabc0000000000000000000000000000000000001';
const RECIPIENT_ID = 'b0000000-0000-0000-0000-000000000099';

describe('MeshService.initiateTransfer', () => {
  it('throws BlockedAddressError BEFORE INSERT and BEFORE Mesh API call when OFAC blocks', async () => {
    const ds = makeDataSource([]); // no INSERT path expected
    const ofac = makeBlocked();
    const mesh = makeMeshClient();
    const secrets = new StubSecretProvider({
      WEBHOOK_BASE_URL: 'http://localhost:3000',
    });

    // member lookup IS expected — OFAC needs the liquid address.
    (ds.query as jest.Mock).mockResolvedValueOnce([
      { bridge_liquid_address: LIQUID_ADDRESS, chain_id: 8453 },
    ]);

    const svc = new MeshService(
      mesh,
      ofac,
      secrets,
      ds,
      new IdempotencyService(),
      makeDb(makeEm([])),
      {} as StateMachineService,
      { emit: jest.fn() } as unknown as DomainEventEmitterService,
    );

    await expect(svc.initiateTransfer(MEMBER_ID, 1_000_000n, RECIPIENT_ID)).rejects.toBeInstanceOf(
      BlockedAddressError,
    );

    // Only the SELECT member ran. NO INSERT into usdc_transactions, NO Mesh API call.
    expect((ds.query as jest.Mock).mock.calls).toHaveLength(1);
    expect(mesh.initiateTransfer).not.toHaveBeenCalled();
  });

  it('inserts MESH_PENDING row, calls Mesh client, returns tx + correlation ids on happy path', async () => {
    const ds = makeDataSource([
      // 1) member lookup
      [{ bridge_liquid_address: LIQUID_ADDRESS, chain_id: 8453 }],
      // 2) INSERT RETURNING tx_id
      [{ tx_id: 'tx-1' }],
    ]);
    const ofac = makeOk();
    const mesh = makeMeshClient();
    const secrets = new StubSecretProvider({
      WEBHOOK_BASE_URL: 'http://localhost:3000',
      [`MESH_TOKENS__${MEMBER_ID}`]: JSON.stringify({
        access: 'a',
        refresh: 'r',
        exp: 0,
        meshAccountId: 'mesh_acct_xyz',
      }),
    });

    const svc = new MeshService(
      mesh,
      ofac,
      secrets,
      ds,
      new IdempotencyService(),
      makeDb(makeEm([])),
      {} as StateMachineService,
      { emit: jest.fn() } as unknown as DomainEventEmitterService,
    );

    const result = await svc.initiateTransfer(MEMBER_ID, 1_000_000n, RECIPIENT_ID);

    expect(result.txId).toBe('tx-1');
    expect(result.meshTransferId).toBe('mesh_tr_xyz');
    expect(result.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // INSERT was called with state=MESH_PENDING and mesh_transfer_id=correlationId.
    // Params order: [memberId, source_type, direction, amount, state, idem, mesh_transfer_id]
    const insertCall = (ds.query as jest.Mock).mock.calls[1];
    expect(insertCall[0]).toMatch(/INSERT INTO usdc_transactions/);
    const params = insertCall[1];
    expect(params[3]).toBe('1000000'); // amount_usdc_wei
    expect(params[4]).toBe(TxState.MESH_PENDING);
    expect(params[6]).toBe(result.correlationId); // mesh_transfer_id
    expect(params[7]).toBe(RECIPIENT_ID); // S-B3 recipient_id at INSERT

    // Mesh client was called with the destination address and chain id from the member row.
    const meshArgs = mesh.initiateTransfer.mock.calls[0][0];
    expect(meshArgs.destinationAddress).toBe(LIQUID_ADDRESS);
    expect(meshArgs.chainId).toBe(8453);
    expect(meshArgs.amountUsdcUnits).toBe(1_000_000n);
    expect(meshArgs.webhookUrl).toBe('http://localhost:3000/webhooks/mesh');
  });

  it('throws on zero or negative amount before any DB or API activity', async () => {
    const ds = makeDataSource([]);
    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      ds,
      new IdempotencyService(),
      makeDb(makeEm([])),
      {} as StateMachineService,
      { emit: jest.fn() } as unknown as DomainEventEmitterService,
    );
    await expect(svc.initiateTransfer(MEMBER_ID, 0n, RECIPIENT_ID)).rejects.toThrow(/positive/);
    await expect(svc.initiateTransfer(MEMBER_ID, -1n, RECIPIENT_ID)).rejects.toThrow(/positive/);
    // S-B3: missing recipient_id is rejected BEFORE any DB I/O.
    await expect(
      svc.initiateTransfer(MEMBER_ID, 1_000_000n, '' as unknown as string),
    ).rejects.toBeInstanceOf(Error);
    expect((ds.query as jest.Mock).mock.calls).toHaveLength(0);
  });
});

describe('MeshService.handleWebhookEvent — transfer.settled', () => {
  function settleEvent(overrides: Partial<{
    correlationId: string;
    transferId: string;
    onChainTxHash: string;
    chainId: number;
    confirmations: number;
    amountDecimal: string;
  }> = {}) {
    return {
      type: 'transfer.settled' as const,
      transferId: overrides.transferId ?? 'mesh_tr_real',
      externalReference: overrides.correlationId ?? 'corr-1',
      onChainTxHash:
        overrides.onChainTxHash ??
        '0x' + 'a'.repeat(64),
      chainId: overrides.chainId ?? 8453,
      confirmations: overrides.confirmations ?? 64,
      amountDecimal: overrides.amountDecimal ?? '1',
    };
  }

  it('credits balance, inserts USDC_LOCKED transition, emits payment.usdc_locked', async () => {
    const em = makeEm([
      // 1) SELECT tx_id by mesh_transfer_id
      [
        {
          tx_id: 'tx-1',
          member_id: MEMBER_ID,
          amount_usdc_wei: '1000000',
        },
      ],
      // 2) current state via view → not yet present (initial MESH_PENDING is in usdc_transactions)
      [],
      // 3) fallback SELECT state FROM usdc_transactions
      [{ state: TxState.MESH_PENDING }],
      // 4) SELECT FOR UPDATE balance
      [{ usdc_virtual_balance_wei: '0' }],
      // 5) UPDATE balance
      undefined,
      // 6) INSERT tx_state_transitions
      undefined,
    ]);
    const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      makeDataSource([]),
      new IdempotencyService(),
      makeDb(em),
      {} as StateMachineService,
      events,
    );

    await svc.handleWebhookEvent(settleEvent());

    // UPDATE balance call had +1_000_000 in its first arg.
    const updateCall = (em.query as jest.Mock).mock.calls[4];
    expect(updateCall[0]).toMatch(/UPDATE member_accounts/);
    expect(updateCall[1][0]).toBe('1000000');

    // INSERT into tx_state_transitions with the right states.
    // Params order: [tx_id, from_state, to_state, metadata]
    const transitionCall = (em.query as jest.Mock).mock.calls[5];
    expect(transitionCall[0]).toMatch(/INSERT INTO tx_state_transitions/);
    const [txId, fromState, toState, metaJson] = transitionCall[1];
    expect(txId).toBe('tx-1');
    expect(fromState).toBe(TxState.MESH_PENDING);
    expect(toState).toBe(TxState.USDC_LOCKED);
    const meta = JSON.parse(metaJson);
    expect(meta.on_chain_tx_hash).toBe('0x' + 'a'.repeat(64));
    expect(meta.confirmations).toBe(64);
    expect(meta.mesh_transfer_id).toBe('mesh_tr_real');

    // Event emitted with USDC_LOCKED.
    expect(events.emit).toHaveBeenCalledTimes(1);
    expect((events.emit as jest.Mock).mock.calls[0][0]).toBe(
      PAYMENT_EVENTS.USDC_LOCKED,
    );
  });

  it('does NOT transition when confirmations are below threshold', async () => {
    const em = makeEm([]);
    const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      makeDataSource([]),
      new IdempotencyService(),
      makeDb(em),
      {} as StateMachineService,
      events,
    );

    await svc.handleWebhookEvent(settleEvent({ confirmations: 5 }));

    // No queries, no events — Mesh will re-fire as confirmations accrue.
    expect((em.query as jest.Mock).mock.calls).toHaveLength(0);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('ignores malformed on_chain_tx_hash', async () => {
    const em = makeEm([]);
    const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      makeDataSource([]),
      new IdempotencyService(),
      makeDb(em),
      {} as StateMachineService,
      events,
    );

    await svc.handleWebhookEvent(settleEvent({ onChainTxHash: 'not-a-hash' }));

    expect((em.query as jest.Mock).mock.calls).toHaveLength(0);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('bails when settled amount mismatches the row amount (defense against tampering)', async () => {
    const em = makeEm([
      [
        {
          tx_id: 'tx-1',
          member_id: MEMBER_ID,
          amount_usdc_wei: '1000000',
        },
      ],
    ]);
    const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      makeDataSource([]),
      new IdempotencyService(),
      makeDb(em),
      {} as StateMachineService,
      events,
    );

    // Mesh says 50 USDC settled — we expected 1.
    await svc.handleWebhookEvent(settleEvent({ amountDecimal: '50' }));

    // Only the lookup ran. No balance UPDATE, no state INSERT, no emit.
    expect((em.query as jest.Mock).mock.calls).toHaveLength(1);
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('bails when current state is already past MESH_PENDING (defense in depth)', async () => {
    const em = makeEm([
      [
        {
          tx_id: 'tx-1',
          member_id: MEMBER_ID,
          amount_usdc_wei: '1000000',
        },
      ],
      [{ current_state: TxState.USDC_LOCKED }],
    ]);
    const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      makeDataSource([]),
      new IdempotencyService(),
      makeDb(em),
      {} as StateMachineService,
      events,
    );

    await svc.handleWebhookEvent(settleEvent());

    // Lookup + state check ran, but no UPDATE/INSERT.
    expect((em.query as jest.Mock).mock.calls).toHaveLength(2);
    expect(events.emit).not.toHaveBeenCalled();
  });
});

describe('MeshService.handleWebhookEvent — transfer.failed', () => {
  it('transitions tx to FAILED via state-machine when correlationId resolves', async () => {
    const ds = makeDataSource([
      [{ tx_id: 'tx-1' }], // lookup by mesh_transfer_id
    ]);
    const sm = {
      transition: jest.fn().mockResolvedValue(undefined),
    } as unknown as StateMachineService;

    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      ds,
      new IdempotencyService(),
      makeDb(makeEm([])),
      sm,
      { emit: jest.fn() } as unknown as DomainEventEmitterService,
    );

    await svc.handleWebhookEvent({
      type: 'transfer.failed',
      transferId: 'mesh_tr_real',
      externalReference: 'corr-1',
      reason: 'wallet_unavailable',
    });

    expect((sm.transition as jest.Mock).mock.calls[0]).toEqual([
      'tx-1',
      TxState.FAILED,
      { reason: 'wallet_unavailable', mesh_transfer_id: 'mesh_tr_real' },
    ]);
  });

  it('logs and returns when correlationId is unknown', async () => {
    const ds = makeDataSource([[]]);
    const sm = {
      transition: jest.fn(),
    } as unknown as StateMachineService;

    const svc = new MeshService(
      makeMeshClient(),
      makeOk(),
      new StubSecretProvider({}),
      ds,
      new IdempotencyService(),
      makeDb(makeEm([])),
      sm,
      { emit: jest.fn() } as unknown as DomainEventEmitterService,
    );

    await svc.handleWebhookEvent({
      type: 'transfer.failed',
      transferId: 'mesh_tr_real',
      externalReference: 'corr-unknown',
      reason: 'r',
    });

    expect(sm.transition).not.toHaveBeenCalled();
  });
});

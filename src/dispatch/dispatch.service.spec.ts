import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DispatchService } from './dispatch.service';
import { OUTBOUND_DISPATCHERS, IOutboundDispatcher } from './outbound-dispatcher.interface';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service';
import { StateMachineService } from '../state-machine/state-machine.service';
import { DomainEventEmitterService } from '../events/domain-event-emitter.service';
import { WebhookDeduplicationService } from '../webhooks/dedup.service';
import { SECRET_PROVIDER } from '../secrets/secret-provider.interface';
import { RecipientsRepository } from '../recipients/recipients.repository';
import { TxState } from '@common/enums';

describe('DispatchService', () => {
  const makeChainDispatcher = (): IOutboundDispatcher => ({
    method: 'WALLET_CHAIN',
    dispatch: jest.fn().mockResolvedValue({ providerRef: '0xabc', duplicate: false }),
  });
  const makeCustodialDispatcher = (): IOutboundDispatcher => ({
    method: 'CUSTODIAL',
    dispatch: jest.fn().mockResolvedValue({ providerRef: 'cust_xyz', duplicate: false }),
  });

  const makeService = async (overrides: {
    chain?: IOutboundDispatcher;
    custodial?: IOutboundDispatcher;
    secrets?: { get: (k: string) => Promise<string> };
    stateMachineCurrent?: TxState;
    txRow?: Record<string, unknown> | null;
    recipientRow?: Record<string, unknown> | null;
    balance?: bigint;
  } = {}) => {
    const chain = overrides.chain ?? makeChainDispatcher();
    const custodial = overrides.custodial ?? makeCustodialDispatcher();
    const secrets = overrides.secrets ?? {
      get: async (k: string) => (k === 'RECIPIENT_DISPATCH_ENABLED' ? 'true' : ''),
    };

    const dataSource = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM usdc_transactions WHERE tx_id')) {
          return overrides.txRow === null ? [] : [overrides.txRow ?? {
            tx_id: 'tx-1', member_id: 'mem-1', amount_usdc_wei: '5000000',
            direction: 'CREDIT', idempotency_key: 'idem-1', recipient_id: 'rcp-1',
          }];
        }
        return [];
      }),
    } as unknown as DataSource;

    const ledger = {
      getBalance: jest.fn(async () => overrides.balance ?? 10_000_000n),
      debitUsdc: jest.fn(async () => undefined),
      creditUsdc: jest.fn(async () => undefined),
    } as unknown as ShadowLedgerService;

    const stateMachine = {
      getCurrentState: jest.fn(async () => overrides.stateMachineCurrent ?? TxState.USDC_LOCKED),
      transition: jest.fn(async () => undefined),
    } as unknown as StateMachineService;

    const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
    const dedup = { markProcessed: jest.fn(async () => true) } as unknown as WebhookDeduplicationService;

    const recipients = {
      findById: jest.fn(async () => overrides.recipientRow === null ? null : (overrides.recipientRow ?? {
        recipient_id: 'rcp-1', member_id: 'mem-1', display_name: 'Alice',
        payout_method: 'WALLET_CHAIN', wallet_chain_id: 1, wallet_address: '0xdead',
        custodial_provider: null, custodial_external_id: null, custodial_last4: null,
        dispatch_status: 'READY', dispatch_error: null, created_at: new Date(),
      })),
    } as unknown as RecipientsRepository;

    const mod = await Test.createTestingModule({
      providers: [
        DispatchService,
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: OUTBOUND_DISPATCHERS, useValue: [chain, custodial] },
        { provide: ShadowLedgerService, useValue: ledger },
        { provide: StateMachineService, useValue: stateMachine },
        { provide: DomainEventEmitterService, useValue: events },
        { provide: WebhookDeduplicationService, useValue: dedup },
        { provide: SECRET_PROVIDER, useValue: secrets },
        { provide: RecipientsRepository, useValue: recipients },
      ],
    }).compile();

    return {
      service: mod.get(DispatchService),
      chain, custodial, stateMachine, ledger, dataSource, recipients,
    };
  };

  it('routes WALLET_CHAIN recipient to chain dispatcher and transitions DISPATCHED', async () => {
    const { service, chain, custodial, stateMachine, ledger } = await makeService();
    await service.dispatchTransfer('tx-1');
    expect((chain.dispatch as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((custodial.dispatch as jest.Mock)).not.toHaveBeenCalled();
    expect(ledger.debitUsdc).toHaveBeenCalled();
    expect(stateMachine.transition).toHaveBeenCalledWith(
      'tx-1', TxState.DISPATCHED, expect.objectContaining({ provider_ref: '0xabc' }),
    );
  });

  it('routes CUSTODIAL recipient to custodial dispatcher', async () => {
    const { service, chain, custodial, stateMachine } = await makeService({
      recipientRow: {
        recipient_id: 'rcp-2', member_id: 'mem-1', display_name: 'Bob',
        payout_method: 'CUSTODIAL', wallet_chain_id: null, wallet_address: null,
        custodial_provider: 'bridge-xyz', custodial_external_id: 'ext-1', custodial_last4: '1234',
        dispatch_status: 'READY', dispatch_error: null, created_at: new Date(),
      },
    });
    await service.dispatchTransfer('tx-1');
    expect((custodial.dispatch as jest.Mock)).toHaveBeenCalledTimes(1);
    expect((chain.dispatch as jest.Mock)).not.toHaveBeenCalled();
    expect(stateMachine.transition).toHaveBeenCalledWith(
      'tx-1', TxState.DISPATCHED, expect.objectContaining({ provider_ref: 'cust_xyz' }),
    );
  });

  it('transitions FAILED_DISPATCH when adapter throws', async () => {
    const chain: IOutboundDispatcher = {
      method: 'WALLET_CHAIN',
      dispatch: jest.fn().mockRejectedValue(new Error('rpc down')),
    };
    const { service, stateMachine, ledger } = await makeService({ chain });
    await service.dispatchTransfer('tx-1');
    expect(stateMachine.transition).toHaveBeenCalledWith(
      'tx-1', TxState.FAILED_DISPATCH, expect.objectContaining({ error: 'rpc down' }),
    );
    expect(ledger.debitUsdc).not.toHaveBeenCalled();
  });

  it('no-ops when RECIPIENT_DISPATCH_ENABLED=false', async () => {
    const { service, chain, custodial, stateMachine } = await makeService({
      secrets: { get: async () => 'false' },
    });
    await service.dispatchTransfer('tx-1');
    expect((chain.dispatch as jest.Mock)).not.toHaveBeenCalled();
    expect((custodial.dispatch as jest.Mock)).not.toHaveBeenCalled();
    expect(stateMachine.transition).not.toHaveBeenCalled();
  });
});

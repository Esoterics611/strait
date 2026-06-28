import { RecipientsService } from './recipients.service';
import { RecipientsRepository } from './recipients.repository';
import { DomainEventEmitterService } from '../events/domain-event-emitter.service';
import { RecipientNotFoundError } from './recipients.errors';
import type { RecipientRow } from './recipient.types';

function row(over: Partial<RecipientRow> = {}): RecipientRow {
  return {
    recipient_id: 'r-1',
    member_id: 'm-1',
    display_name: 'Maya Cohen',
    relationship: 'Sister',
    payout_method: 'WALLET_CHAIN',
    wallet_chain_id: 8453,
    wallet_address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    custodial_provider: null,
    custodial_external_id: null,
    custodial_last4: null,
    dispatch_status: 'READY',
    dispatch_error: null,
    created_at: new Date('2026-05-01T00:00:00Z'),
    ...over,
  };
}

function make() {
  const repo = {
    create: jest.fn().mockResolvedValue(row()),
    findById: jest.fn().mockResolvedValue(row()),
    findForOwner: jest.fn().mockResolvedValue(row()),
    listByOwner: jest.fn().mockResolvedValue([row()]),
    updateDisplay: jest.fn().mockResolvedValue(row({ display_name: 'New' })),
    isReferencedByTransfers: jest.fn().mockResolvedValue(false),
    hardDelete: jest.fn().mockResolvedValue(undefined),
    lockedTxIdsForRecipient: jest.fn().mockResolvedValue([]),
    setDispatchStatus: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<RecipientsRepository>;

  const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
  const svc = new RecipientsService(repo, events);
  return { svc, repo, events };
}

describe('RecipientsService', () => {
  it('creates a WALLET_CHAIN recipient at READY', async () => {
    const { svc, repo } = make();
    const dto = await svc.create('m-1', {
      displayName: 'Maya Cohen',
      payoutMethod: 'WALLET_CHAIN',
      wallet: { chainId: 8453, walletAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    });
    expect(dto.dispatchStatus).toBe('READY');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ dispatchStatus: 'READY' }));
  });

  it('creates a CUSTODIAL recipient at UNREGISTERED', async () => {
    const { svc, repo } = make();
    repo.create.mockResolvedValueOnce(row({ payout_method: 'CUSTODIAL', dispatch_status: 'UNREGISTERED', wallet_chain_id: null, wallet_address: null, custodial_provider: 'fireblocks', custodial_external_id: 'ext-1' }));
    const dto = await svc.create('m-1', {
      displayName: 'Bob',
      payoutMethod: 'CUSTODIAL',
      custodial: { providerKey: 'fireblocks', externalAccountId: 'ext-1' },
    });
    expect(dto.dispatchStatus).toBe('UNREGISTERED');
  });

  it('throws for WALLET_CHAIN without wallet params', async () => {
    const { svc } = make();
    await expect(
      svc.create('m-1', { displayName: 'X', payoutMethod: 'WALLET_CHAIN' }),
    ).rejects.toThrow('wallet params required');
  });

  it('throws for CUSTODIAL without custodial params', async () => {
    const { svc } = make();
    await expect(
      svc.create('m-1', { displayName: 'X', payoutMethod: 'CUSTODIAL' }),
    ).rejects.toThrow('custodial params required');
  });

  it('get() throws when not owned', async () => {
    const { svc, repo } = make();
    repo.findForOwner.mockResolvedValueOnce(null);
    await expect(svc.get('m-1', 'nope')).rejects.toBeInstanceOf(RecipientNotFoundError);
  });

  it('remove() retains a recipient referenced by transfers', async () => {
    const { svc, repo } = make();
    repo.isReferencedByTransfers.mockResolvedValueOnce(true);
    await svc.remove('m-1', 'r-1');
    expect(repo.hardDelete).not.toHaveBeenCalled();
  });

  it('remove() purges an unreferenced recipient', async () => {
    const { svc, repo } = make();
    await svc.remove('m-1', 'r-1');
    expect(repo.hardDelete).toHaveBeenCalledWith('r-1');
  });

  it('reDrivePending() re-emits usdc_locked for parked transfers', async () => {
    const { svc, repo, events } = make();
    repo.lockedTxIdsForRecipient.mockResolvedValueOnce(['tx-1', 'tx-2']);
    const count = await svc.reDrivePending('r-1');
    expect(count).toBe(2);
    expect(events.emit).toHaveBeenCalledTimes(2);
  });
});

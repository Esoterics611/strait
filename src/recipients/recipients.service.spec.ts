import { RecipientsService } from './recipients.service';
import { RecipientsRepository } from './recipients.repository';
import { IBridgeRecipientClient } from './bridge-recipient-client.interface';
import { DomainEventEmitterService } from '../events/domain-event-emitter.service';
import { DuplicateRecipientError, RecipientNotFoundError } from './recipients.errors';
import type { RecipientRow } from './recipient.types';

function row(over: Partial<RecipientRow> = {}): RecipientRow {
  return {
    recipient_id: 'r-1',
    owner_member_id: 'm-1',
    display_name: 'Maya Cohen',
    country: 'US',
    relationship: 'Sister',
    payout_method: 'BANK_RTP',
    bank_account_last4: '4321',
    bank_routing_last4: '0021',
    bank_token: 'btok_abc',
    bridge_status: 'REGISTERING',
    bridge_customer_ref: null,
    bridge_liquidation_address: null,
    bridge_external_account_id: null,
    bridge_last_error: null,
    linked_member_id: null,
    created_at: new Date('2026-05-01T00:00:00Z'),
    updated_at: new Date('2026-05-01T00:00:00Z'),
    ...over,
  };
}

function make() {
  const repo = {
    findByOwnerAndBankToken: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue(row()),
    findById: jest.fn().mockResolvedValue(row()),
    findForOwner: jest.fn().mockResolvedValue(row()),
    setRegistered: jest.fn().mockResolvedValue(undefined),
    setStatus: jest.fn().mockResolvedValue(undefined),
    applyBankChange: jest.fn().mockResolvedValue(row({ bridge_status: 'REGISTERING' })),
    updateDisplay: jest.fn().mockResolvedValue(row({ display_name: 'New' })),
    isReferencedByTransfers: jest.fn().mockResolvedValue(false),
    hardDelete: jest.fn().mockResolvedValue(undefined),
    lockedTxIdsForRecipient: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<RecipientsRepository>;

  const bridge: jest.Mocked<IBridgeRecipientClient> = {
    registerRecipient: jest.fn().mockResolvedValue({
      bridgeCustomerRef: 'cus_1',
      bridgeLiquidationAddress: '0xabc',
      bridgeExternalAccountId: 'ext_1',
    }),
  };
  const events = { emit: jest.fn() } as unknown as DomainEventEmitterService;
  const svc = new RecipientsService(repo, bridge, events);
  return { svc, repo, bridge, events };
}

describe('RecipientsService', () => {
  it('creates a recipient at REGISTERING and dedupes on bank token', async () => {
    const { svc, repo } = make();
    const dto = await svc.create('m-1', {
      displayName: 'Maya Cohen',
      payoutMethod: 'BANK_RTP',
      bank: { accountNumber: '12344321', routingNumber: '021000021', accountType: 'checking' },
    });
    expect(dto.bridgeStatus).toBe('REGISTERING');
    expect(repo.create).toHaveBeenCalled();
  });

  it('rejects a duplicate (same owner + bank token)', async () => {
    const { svc, repo } = make();
    repo.findByOwnerAndBankToken.mockResolvedValueOnce(row({ display_name: 'Existing' }));
    await expect(
      svc.create('m-1', {
        displayName: 'X',
        payoutMethod: 'BANK_ACH',
        bank: { accountNumber: '999', routingNumber: '021000021', accountType: 'savings' },
      }),
    ).rejects.toBeInstanceOf(DuplicateRecipientError);
  });

  it('register() drives REGISTERING → READY and re-drives parked transfers', async () => {
    const { svc, repo, events } = make();
    repo.lockedTxIdsForRecipient.mockResolvedValueOnce(['tx-1', 'tx-2']);
    await svc.register('r-1');
    expect(repo.setRegistered).toHaveBeenCalledWith('r-1', {
      customerRef: 'cus_1',
      liquidationAddress: '0xabc',
      externalAccountId: 'ext_1',
    });
    expect(events.emit).toHaveBeenCalledTimes(2);
  });

  it('register() failure marks the recipient FAILED with the error', async () => {
    const { svc, repo, bridge } = make();
    bridge.registerRecipient.mockRejectedValueOnce(new Error('bank rejected'));
    await svc.register('r-1');
    expect(repo.setStatus).toHaveBeenCalledWith('r-1', 'FAILED', 'bank rejected');
  });

  it('bank change re-registers (pauses transfers until READY)', async () => {
    const { svc, repo } = make();
    await svc.update('m-1', 'r-1', {
      bank: { accountNumber: '55556666', routingNumber: '021000021', accountType: 'checking' },
    });
    expect(repo.applyBankChange).toHaveBeenCalled();
    expect(repo.updateDisplay).not.toHaveBeenCalled();
  });

  it('display-only update does not touch the bank or bridge status', async () => {
    const { svc, repo } = make();
    await svc.update('m-1', 'r-1', { displayName: 'New' });
    expect(repo.updateDisplay).toHaveBeenCalled();
    expect(repo.applyBankChange).not.toHaveBeenCalled();
  });

  it('get() throws when not owned', async () => {
    const { svc, repo } = make();
    repo.findForOwner.mockResolvedValueOnce(null);
    await expect(svc.get('m-1', 'nope')).rejects.toBeInstanceOf(
      RecipientNotFoundError,
    );
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
});

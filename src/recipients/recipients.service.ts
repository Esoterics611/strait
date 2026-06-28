import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BusinessLogger } from '@common/logging';
import { RecipientsRepository } from './recipients.repository';
import { DuplicateRecipientError, RecipientNotFoundError } from './recipients.errors';
import {
  CreateRecipientReq,
  RecipientDto,
  UpdateRecipientReq,
  toRecipientDto,
} from './recipient.types';
import {
  DomainEventEmitterService,
  PAYMENT_EVENTS,
} from '../events/domain-event-emitter.service';
import { IDomainEvent } from '@common/interfaces';

@Injectable()
export class RecipientsService {
  private readonly blog = new BusinessLogger('RecipientsService');

  constructor(
    private readonly repo: RecipientsRepository,
    private readonly events: DomainEventEmitterService,
  ) {}

  async list(memberid: string): Promise<RecipientDto[]> {
    const rows = await this.repo.listByOwner(memberid);
    return rows.map(toRecipientDto);
  }

  async get(memberid: string, recipientId: string): Promise<RecipientDto> {
    const row = await this.repo.findForOwner(recipientId, memberid);
    if (!row) throw new RecipientNotFoundError(recipientId);
    return toRecipientDto(row);
  }

  async create(memberid: string, req: CreateRecipientReq): Promise<RecipientDto> {
    // For WALLET_CHAIN, validate and set READY immediately (no external registration).
    // For CUSTODIAL, set UNREGISTERED until the adapter registers it.
    const isWallet = req.payoutMethod === 'WALLET_CHAIN';
    const dispatchStatus = isWallet ? 'READY' : 'UNREGISTERED';

    if (isWallet && !req.wallet) {
      throw new Error('wallet params required for WALLET_CHAIN payoutMethod');
    }
    if (!isWallet && !req.custodial) {
      throw new Error('custodial params required for CUSTODIAL payoutMethod');
    }

    const row = await this.repo.create({
      memberid,
      displayName: req.displayName,
      relationship: req.relationship ?? null,
      payoutMethod: req.payoutMethod,
      walletChainId: req.wallet?.chainId,
      walletAddress: req.wallet?.walletAddress,
      custodialProvider: req.custodial?.providerKey,
      custodialExternalId: req.custodial?.externalAccountId,
      dispatchStatus,
    });

    this.blog.info('create', {
      memberId: memberid,
      recipientId: row.recipient_id,
      detail: { outcome: 'created', payoutMethod: req.payoutMethod, dispatchStatus },
    });

    return toRecipientDto(row);
  }

  async update(
    memberid: string,
    recipientId: string,
    req: UpdateRecipientReq,
  ): Promise<RecipientDto> {
    const existing = await this.repo.findForOwner(recipientId, memberid);
    if (!existing) throw new RecipientNotFoundError(recipientId);
    const updated = await this.repo.updateDisplay(recipientId, {
      displayName: req.displayName,
      relationship: req.relationship,
    });
    return toRecipientDto(updated);
  }

  async remove(memberid: string, recipientId: string): Promise<void> {
    const row = await this.repo.findForOwner(recipientId, memberid);
    if (!row) return;
    if (await this.repo.isReferencedByTransfers(recipientId)) {
      this.blog.info('remove', {
        memberId: memberid,
        recipientId,
        detail: { outcome: 'retained_referenced_by_transfers' },
      });
      return;
    }
    await this.repo.hardDelete(recipientId);
  }

  // Re-drives any USDC_LOCKED transfers for a recipient that just became READY.
  async reDrivePending(recipientId: string): Promise<number> {
    const txIds = await this.repo.lockedTxIdsForRecipient(recipientId);
    for (const txId of txIds) {
      const event: IDomainEvent<{ txId: string }> = {
        eventId: randomUUID(),
        occurredAt: new Date(),
        aggregateId: txId,
        aggregateType: 'UsdcTransaction',
        eventType: PAYMENT_EVENTS.USDC_LOCKED,
        payload: { txId },
      };
      this.events.emit(PAYMENT_EVENTS.USDC_LOCKED, event);
    }
    return txIds.length;
  }
}

import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { BusinessLogger } from '@common/logging';
import {
  BRIDGE_RECIPIENT_CLIENT,
  IBridgeRecipientClient,
} from './bridge-recipient-client.interface';
import { RecipientsRepository } from './recipients.repository';
import { tokenizeBank } from './bank-tokenizer';
import {
  DuplicateRecipientError,
  RecipientNotFoundError,
} from './recipients.errors';
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
    @Inject(BRIDGE_RECIPIENT_CLIENT)
    private readonly bridgeRecipient: IBridgeRecipientClient,
    private readonly events: DomainEventEmitterService,
  ) {}

  async list(ownerMemberId: string): Promise<RecipientDto[]> {
    const rows = await this.repo.listByOwner(ownerMemberId);
    return rows.map(toRecipientDto);
  }

  async get(ownerMemberId: string, recipientId: string): Promise<RecipientDto> {
    const row = await this.repo.findForOwner(recipientId, ownerMemberId);
    if (!row) throw new RecipientNotFoundError(recipientId);
    return toRecipientDto(row);
  }

  async create(
    ownerMemberId: string,
    req: CreateRecipientReq,
  ): Promise<RecipientDto> {
    const tok = tokenizeBank(req.bank);
    const dup = await this.repo.findByOwnerAndBankToken(
      ownerMemberId,
      tok.bankToken,
    );
    if (dup) {
      this.blog.info('create', {
        memberId: ownerMemberId,
        recipientId: dup.recipient_id,
        detail: { outcome: 'dedupe_hit', existingRecipientId: dup.recipient_id },
      });
      throw new DuplicateRecipientError(dup.display_name);
    }

    const row = await this.repo.create({
      ownerMemberId,
      displayName: req.displayName,
      relationship: req.relationship ?? null,
      payoutMethod: req.payoutMethod,
      bankAccountLast4: tok.accountLast4,
      bankRoutingLast4: tok.routingLast4,
      bankToken: tok.bankToken,
    });

    this.blog.info('create', {
      memberId: ownerMemberId,
      recipientId: row.recipient_id,
      detail: {
        outcome: 'created',
        last4: tok.accountLast4,
        bankToken: tok.bankToken,
      },
    });

    // Lazy, background Bridge registration (Remitly-style). The sender may
    // proceed through the wizard while REGISTERING; dispatch is gated on READY.
    void this.register(row.recipient_id);
    return toRecipientDto(row);
  }

  async update(
    ownerMemberId: string,
    recipientId: string,
    req: UpdateRecipientReq,
  ): Promise<RecipientDto> {
    const existing = await this.repo.findForOwner(recipientId, ownerMemberId);
    if (!existing) throw new RecipientNotFoundError(recipientId);

    if (req.bank) {
      const tok = tokenizeBank(req.bank);
      const updated = await this.repo.applyBankChange(
        recipientId,
        tok.accountLast4,
        tok.routingLast4,
        tok.bankToken,
      );
      this.blog.info('update', {
        memberId: ownerMemberId,
        recipientId,
        detail: {
          outcome: 'bank_change_re_register',
          oldLast4: existing.bank_account_last4,
          newLast4: tok.accountLast4,
        },
      });
      // Bank change re-verifies the recipient and pauses transfers until READY.
      void this.register(recipientId);
      return toRecipientDto(updated);
    }

    const updated = await this.repo.updateDisplay(recipientId, {
      displayName: req.displayName,
      relationship: req.relationship,
      payoutMethod: req.payoutMethod,
    });
    return toRecipientDto(updated);
  }

  async remove(ownerMemberId: string, recipientId: string): Promise<void> {
    const row = await this.repo.findForOwner(recipientId, ownerMemberId);
    if (!row) return; // idempotent delete
    // Soft behaviour: if historical transfers reference it, keep the row
    // (append-only history must remain joinable). Only purge when unreferenced.
    if (await this.repo.isReferencedByTransfers(recipientId)) {
      this.blog.info('remove', {
        memberId: ownerMemberId,
        recipientId,
        detail: { outcome: 'retained_referenced_by_transfers' },
      });
      return;
    }
    await this.repo.hardDelete(recipientId);
  }

  // Performs the Bridge registration call and resolves the lifecycle. Public
  // so tests can await it deterministically; production calls it fire-and-forget.
  async register(recipientId: string): Promise<void> {
    const row = await this.repo.findById(recipientId);
    if (!row) return;
    this.blog.info('register', {
      recipientId,
      detail: { phase: 'bridge_registration_start' },
    });
    const startedAt = Date.now();
    try {
      const refs = await this.bridgeRecipient.registerRecipient({
        recipientId: row.recipient_id,
        displayName: row.display_name,
        payoutMethod: row.payout_method,
        bankToken: row.bank_token ?? '',
        country: row.country,
      });
      await this.repo.setRegistered(recipientId, {
        customerRef: refs.bridgeCustomerRef,
        liquidationAddress: refs.bridgeLiquidationAddress,
        externalAccountId: refs.bridgeExternalAccountId,
      });
      const reDriven = await this.reDrivePending(recipientId);
      this.blog.info('register', {
        recipientId,
        detail: {
          outcome: 'READY',
          bridgeCustomerRef: refs.bridgeCustomerRef,
          reDriveCount: reDriven,
        },
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      this.blog.error('register', {
        recipientId,
        detail: { outcome: 'FAILED' },
        error: err,
        durationMs: Date.now() - startedAt,
      });
      await this.repo.setStatus(recipientId, 'FAILED', (err as Error).message);
    }
  }

  // When a recipient becomes READY, re-emit payment.usdc_locked for any of its
  // transfers still parked at USDC_LOCKED so BridgeDispatchListener re-drives
  // them. dispatchTransfer is idempotent (it re-checks state == USDC_LOCKED).
  private async reDrivePending(recipientId: string): Promise<number> {
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

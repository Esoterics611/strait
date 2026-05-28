import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { BusinessLogger } from '@common/logging';
import { SECRET_PROVIDER, ISecretProvider } from '../secrets/secret-provider.interface';
import {
  DispatchPayload,
  DispatchResult,
  IOutboundDispatcher,
  PayoutMethod,
} from './outbound-dispatcher.interface';
import { DispatchError } from './dispatch.errors';

// Third-party custodial crypto pay-out adapter. Mock-default; the real
// impl is provider-specific (e.g. Bridge.xyz crypto API, Fireblocks).
// Idempotency: the provider must accept idempotencyKey so a retried
// HTTP call returns the same transfer id without double-paying.
//
// Settlement is asynchronous — the provider posts back via webhook
// (handled by DispatchService.handleCustodialSettlementWebhook).
@Injectable()
export class CustodialDispatcher implements IOutboundDispatcher {
  readonly method: PayoutMethod = 'CUSTODIAL';
  private readonly blog = new BusinessLogger('CustodialDispatcher');

  constructor(@Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider) {}

  async dispatch(payload: DispatchPayload): Promise<DispatchResult> {
    const { recipient, amountUsdcUnits, txId, idempotencyKey } = payload;

    if (recipient.payout_method !== 'CUSTODIAL') {
      throw new DispatchError(
        `CustodialDispatcher invoked with non-CUSTODIAL recipient: ${recipient.payout_method}`,
      );
    }
    if (!recipient.custodial_provider || !recipient.custodial_external_id) {
      throw new DispatchError(
        `CUSTODIAL recipient ${recipient.recipient_id} missing provider or external_id`,
      );
    }

    const mockEnabled = await this.isMockEnabled();
    if (mockEnabled) {
      return this.mockDispatch(payload);
    }

    // Real custodial provider call seam. Each provider gets a small
    // shim under e.g. src/dispatch/providers/<name>.client.ts that
    // implements POST /transfers with the canonical request.
    this.blog.warn('dispatch', {
      txId,
      recipientId: recipient.recipient_id,
      detail: {
        provider: recipient.custodial_provider,
        externalAccountId: recipient.custodial_external_id,
        idempotencyKey,
        outcome: 'real_custodial_dispatch_not_implemented',
      },
    });
    throw new DispatchError(
      'Real custodial dispatch not implemented; set MOCK_DISPATCH_ENABLED=true or wire CustodialDispatcher real impl.',
    );
  }

  private async mockDispatch(payload: DispatchPayload): Promise<DispatchResult> {
    const { recipient, amountUsdcUnits, txId } = payload;
    const providerRef = 'cust_' + randomBytes(12).toString('hex');

    const settleMs = await this.mockSettleMs();
    if (settleMs > 0) {
      await new Promise((r) => setTimeout(r, settleMs));
    }

    const failureRate = await this.mockFailureRate();
    if (failureRate > 0 && Math.random() < failureRate) {
      throw new DispatchError('mock custodial dispatch failed (mockFailureRate)');
    }

    this.blog.info('mockDispatch', {
      txId,
      recipientId: recipient.recipient_id,
      detail: {
        provider: recipient.custodial_provider,
        externalAccountId: recipient.custodial_external_id,
        amount: amountUsdcUnits.toString(),
        providerRef,
      },
    });

    return { providerRef, duplicate: false };
  }

  private async isMockEnabled(): Promise<boolean> {
    try {
      return (await this.secrets.get('MOCK_DISPATCH_ENABLED')) !== 'false';
    } catch {
      return true;
    }
  }

  private async mockSettleMs(): Promise<number> {
    try {
      return parseInt((await this.secrets.get('MOCK_DISPATCH_SETTLE_MS')) || '250', 10);
    } catch {
      return 250;
    }
  }

  private async mockFailureRate(): Promise<number> {
    try {
      return parseFloat((await this.secrets.get('MOCK_DISPATCH_FAILURE_RATE')) || '0');
    } catch {
      return 0;
    }
  }
}

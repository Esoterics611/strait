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
import { DispatchError, UnsupportedChainError } from './dispatch.errors';

const SUPPORTED_CHAINS = [1, 8453];

// Direct on-chain USDC transfer adapter. Mock-default — the real impl
// (ethers / viem-based signer + ERC20.transfer) lives behind the same
// interface so flipping MOCK_DISPATCH_ENABLED swaps it in.
@Injectable()
export class ChainDispatcher implements IOutboundDispatcher {
  readonly method: PayoutMethod = 'WALLET_CHAIN';
  private readonly blog = new BusinessLogger('ChainDispatcher');

  constructor(@Inject(SECRET_PROVIDER) private readonly secrets: ISecretProvider) {}

  async dispatch(payload: DispatchPayload): Promise<DispatchResult> {
    const { recipient, amountUsdcUnits, txId, idempotencyKey } = payload;

    if (recipient.payout_method !== 'WALLET_CHAIN') {
      throw new DispatchError(
        `ChainDispatcher invoked with non-WALLET_CHAIN recipient: ${recipient.payout_method}`,
      );
    }
    if (!recipient.wallet_chain_id || !recipient.wallet_address) {
      throw new DispatchError(
        `WALLET_CHAIN recipient ${recipient.recipient_id} missing chain_id or wallet_address`,
      );
    }
    if (!SUPPORTED_CHAINS.includes(recipient.wallet_chain_id)) {
      throw new UnsupportedChainError(recipient.wallet_chain_id);
    }

    const mockEnabled = await this.isMockEnabled();
    if (mockEnabled) {
      return this.mockDispatch(payload);
    }

    // Real on-chain transfer seam. Not implemented in this scaffold —
    // when CHAIN_RPC_URL + CHAIN_PRIVATE_KEY are wired, this becomes
    // a signed ERC20.transfer(walletAddress, amountUsdcUnits) call on
    // the USDC contract for the chosen chain. The tx hash returned by
    // the signer becomes providerRef. Idempotency is enforced upstream
    // by checking idempotencyKey against an existing
    // dispatched-tx-hash row before submitting.
    this.blog.warn('dispatch', {
      txId,
      recipientId: recipient.recipient_id,
      detail: {
        chainId: recipient.wallet_chain_id,
        walletAddress: recipient.wallet_address,
        idempotencyKey,
        outcome: 'real_chain_dispatch_not_implemented',
      },
    });
    throw new DispatchError(
      'Real chain dispatch not implemented; set MOCK_DISPATCH_ENABLED=true or wire ChainDispatcher real impl.',
    );
  }

  private async mockDispatch(payload: DispatchPayload): Promise<DispatchResult> {
    const { recipient, amountUsdcUnits, txId } = payload;
    const providerRef = '0x' + randomBytes(32).toString('hex');

    const settleMs = await this.mockSettleMs();
    if (settleMs > 0) {
      await new Promise((r) => setTimeout(r, settleMs));
    }

    const failureRate = await this.mockFailureRate();
    if (failureRate > 0 && Math.random() < failureRate) {
      throw new DispatchError('mock chain dispatch failed (mockFailureRate)');
    }

    this.blog.info('mockDispatch', {
      txId,
      recipientId: recipient.recipient_id,
      detail: {
        chainId: recipient.wallet_chain_id,
        walletAddress: recipient.wallet_address,
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

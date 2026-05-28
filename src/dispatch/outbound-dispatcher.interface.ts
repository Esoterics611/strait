// IOutboundDispatcher — the seam for delivering USDC to a recipient. Two
// adapters live behind this interface today: ChainDispatcher (direct
// on-chain USDC transfer) and CustodialDispatcher (third-party crypto
// pay-out provider). The dispatcher selected per-call is determined by
// the recipient's payout_method discriminator, not configuration.
//
// Both adapters default to a mock implementation gated by MOCK_DISPATCH_ENABLED.
// Real implementations live behind the same interface — flipping the secret
// flag swaps them in without changing call sites (CLAUDE.md secret-flag
// discipline: per-call read, no cache).

import type { RecipientRow } from '../recipients/recipient.types';

export const OUTBOUND_DISPATCHERS = Symbol('OUTBOUND_DISPATCHERS');

export type PayoutMethod = 'WALLET_CHAIN' | 'CUSTODIAL';

export interface DispatchPayload {
  // SHA-256 idempotency key from usdc_transactions.idempotency_key. The
  // adapter must use this so a retried call to the underlying provider
  // returns the same provider_ref without double-spending.
  idempotencyKey: string;
  recipient: RecipientRow;
  amountUsdcUnits: bigint;
  txId: string;
}

export interface DispatchResult {
  // Chain adapter: 0x-prefixed on-chain transaction hash.
  // Custodial adapter: provider's transfer ID (opaque token).
  providerRef: string;
  // True when the underlying provider returned an existing record for
  // this idempotency key (no new debit should be applied).
  duplicate: boolean;
}

export interface IOutboundDispatcher {
  readonly method: PayoutMethod;
  dispatch(payload: DispatchPayload): Promise<DispatchResult>;
}

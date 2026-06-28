import type { Recipient, PayoutMethod, DispatchStatus } from '@strait/contract';

export type RecipientPayoutMethod = PayoutMethod;
export type RecipientDispatchStatus = DispatchStatus;

export interface RecipientRow {
  recipient_id: string;
  member_id: string;
  display_name: string;
  relationship: string | null;

  payout_method: RecipientPayoutMethod;

  // WALLET_CHAIN — non-null iff payout_method === 'WALLET_CHAIN'
  wallet_chain_id: number | null;   // 1 (Ethereum mainnet) | 8453 (Base)
  wallet_address: string | null;    // 0x-prefixed

  // CUSTODIAL — non-null iff payout_method === 'CUSTODIAL'
  custodial_provider: string | null;
  custodial_external_id: string | null;
  custodial_last4: string | null;

  dispatch_status: RecipientDispatchStatus;
  dispatch_error: string | null;

  created_at: Date;
}

export type RecipientDto = Recipient;

export interface CreateRecipientReq {
  displayName: string;
  relationship?: string;
  payoutMethod: RecipientPayoutMethod;
  wallet?: { chainId: 1 | 8453; walletAddress: string };
  custodial?: { providerKey: string; externalAccountId: string };
}

export type UpdateRecipientReq = Partial<Pick<CreateRecipientReq, 'displayName' | 'relationship'>>;

export function toRecipientDto(row: RecipientRow): RecipientDto {
  return {
    recipientId: row.recipient_id,
    displayName: row.display_name,
    relationship: row.relationship,
    payoutMethod: row.payout_method,
    dispatchStatus: row.dispatch_status,
    dispatchError: row.dispatch_error,
    createdAt: (row.created_at instanceof Date ? row.created_at : new Date(row.created_at)).toISOString(),
    wallet: row.payout_method === 'WALLET_CHAIN' && row.wallet_chain_id && row.wallet_address
      ? { chainId: row.wallet_chain_id as 1 | 8453, walletAddress: row.wallet_address }
      : null,
    custodial: row.payout_method === 'CUSTODIAL' && row.custodial_provider
      ? { providerKey: row.custodial_provider, last4: row.custodial_last4 }
      : null,
  };
}

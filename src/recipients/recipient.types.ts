// Canonical shape of a row in the `recipients` table, as returned by
// RecipientsRepository. Snake-case matches the DB column names (existing
// repo-returns-raw-rows convention). The `@strait/contract` Recipient
// shape (used over the wire) is camelCase and is projected from this row
// by RecipientsService.toPublic().
export type RecipientPayoutMethod = 'WALLET_CHAIN' | 'CUSTODIAL';

export type RecipientDispatchStatus =
  | 'UNREGISTERED'
  | 'REGISTERING'
  | 'READY'
  | 'FAILED';

export interface RecipientRow {
  recipient_id: string;
  member_id: string;
  display_name: string;
  relationship: string | null;

  payout_method: RecipientPayoutMethod;

  // WALLET_CHAIN fields — non-null iff payout_method === 'WALLET_CHAIN'
  wallet_chain_id: number | null;   // 1 (Ethereum mainnet) | 8453 (Base)
  wallet_address: string | null;    // 0x-prefixed

  // CUSTODIAL fields — non-null iff payout_method === 'CUSTODIAL'
  custodial_provider: string | null;
  custodial_external_id: string | null;
  custodial_last4: string | null;

  dispatch_status: RecipientDispatchStatus;
  dispatch_error: string | null;

  created_at: Date;
}

// @strait/contract — the SINGLE authoritative definition of the Strait
// UI <-> API wire contract. Consumed by both client/ (web) and src/ (api).
// Type-only: every consumer uses `import type`, so the import is erased at
// compile time — there is NO runtime module to resolve. A breaking edit
// here fails BOTH typechecks.
//
// Strait is crypto-in / crypto-out: USDC funded via Mesh (Path A), USDC
// dispatched to recipients via on-chain wallet transfer or a custodial
// pay-out provider. No ILS. No fiat rails. All money is integer minor
// units as strings, never floats. USDC has 6 decimals — 1 USDC = 1_000_000.

// ---- State machine wire enums (single source) ----
export type TxState =
  | 'MESH_PENDING'
  | 'USDC_LOCKED'
  | 'DISPATCHED'
  | 'SETTLED'
  | 'FAILED'
  | 'FAILED_DISPATCH'
  | 'REFUND_QUEUED'
  | 'REFUNDED';

export type StageKey =
  | 'FUNDING'
  | 'READYING'
  | 'DELIVERING'
  | 'DONE'
  | 'FAILED'
  | 'FAILED_DISPATCH'
  | 'REVERSING'
  | 'REFUNDED';

// ---- Money ----
// USDC only on-the-wire. 6-decimal minor units (1 USDC = "1000000").
export type CurrencyCode = 'USDC';
export interface Money {
  currency: CurrencyCode;
  minor: string;
}

// ---- Auth / member ----
export type KycStatus = 'NONE' | 'PENDING' | 'VERIFIED' | 'REJECTED';
export interface Member {
  memberId: string;
  email: string | null;
  phone: string | null;
  displayName: string | null;
  country: string;
  kycStatus: KycStatus;
  createdAt: string;
}
export interface AuthStartResp {
  challengeId: string;
  channel: 'email' | 'sms';
}
export interface AuthVerifyResp {
  token: string;
  member: Member;
  isNewMember: boolean;
}

// ---- Recipients (crypto-out targets) ----
export type PayoutMethod = 'WALLET_CHAIN' | 'CUSTODIAL';
export type ChainId = 1 | 8453; // Ethereum mainnet | Base
export type DispatchStatus = 'UNREGISTERED' | 'REGISTERING' | 'READY' | 'FAILED';

export interface WalletChainParams {
  chainId: ChainId;
  walletAddress: string; // 0x-prefixed, EIP-55 checksummed
}
export interface CustodialParams {
  providerKey: string; // which custodial adapter
  externalAccountId: string; // opaque token; never raw PII
}

export interface Recipient {
  recipientId: string;
  displayName: string;
  relationship: string | null;
  payoutMethod: PayoutMethod;
  wallet: WalletChainParams | null;
  custodial: { providerKey: string; last4: string | null } | null;
  dispatchStatus: DispatchStatus;
  dispatchError: string | null;
  createdAt: string;
}
export interface CreateRecipientReq {
  displayName: string;
  relationship?: string;
  payoutMethod: PayoutMethod;
  wallet?: WalletChainParams;
  custodial?: CustodialParams;
}
export type UpdateRecipientReq = Partial<
  Pick<Recipient, 'displayName' | 'relationship'>
>;

// ---- Inbound paths ----
export type PayInMethod = 'MESH';
export interface PayInOption {
  method: PayInMethod;
  available: boolean;
  unavailableReason: string | null;
  speedText: string;
  feeNote: string | null;
}

// ---- Quote ----
export interface QuoteReq {
  recipientId: string;
  send: Money;
  payInMethod: PayInMethod;
  payOutMethod: PayoutMethod;
}
export interface Quote {
  quoteId: string;
  send: Money;
  fee: Money;
  receive: Money;
  payInMethod: PayInMethod;
  payOutMethod: PayoutMethod;
  etaText: string;
  etaEarliest: string;
  etaLatest: string;
  expiresAt: string;
}

// ---- Transfer ----
export interface CreateTransferReq {
  quoteId: string;
}
export interface PayInInstructions {
  method: PayInMethod;
  mesh: { connectUrl: string };
}
export interface Transfer {
  txId: string;
  recipient: Recipient;
  quote: Quote;
  state: TxState;
  createdAt: string;
  payIn: PayInInstructions;
}
export interface TransferListItem {
  txId: string;
  recipientName: string;
  send: Money;
  receive: Money;
  state: TxState;
  createdAt: string;
}

// ---- Live status (SSE) ----
export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'closed';
export interface StatusSnapshot {
  state: TxState;
  stage: StageKey;
  etaText: string | null;
  dispatchTxHash: string | null;
  settledAt: string | null;
  payoutMethodUsed: PayoutMethod | null;
  failureReason: string | null;
  refundExpectedBy: string | null;
}

// ---- Pagination ----
export interface TransferPage {
  items: TransferListItem[];
  nextCursor: string | null;
}

export const MESH_API_CLIENT = Symbol('MESH_API_CLIENT');

export interface MeshOAuthPayload {
  // Opaque from Mesh's hosted Connect flow — passed verbatim from the client
  // to MeshService.connectMember and exchanged for access/refresh tokens.
  authorizationCode: string;
  codeVerifier: string;
  redirectUri: string;
}

export interface MeshConnectResult {
  // Mesh's own customer id for the connected wallet/CEX account.
  meshAccountId: string;
  // Tokens are immediately handed to the SecretProvider and never live in DB.
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix seconds
}

export interface InitiateTransferPayload {
  // Our correlation id — sent as Idempotency-Key and as a Mesh metadata field.
  correlationId: string;
  meshAccountId: string;
  // Amount in 6-decimal USDC units (matches Lira-Bridge's internal convention).
  amountUsdcUnits: bigint;
  // Where Mesh should deliver the USDC. For Path A this is the member's
  // Bridge Liquid Address (already on member_accounts).
  destinationAddress: string;
  chainId: number;
  // The webhook URL Mesh should POST lifecycle events to.
  webhookUrl: string;
}

export interface InitiateTransferResult {
  meshTransferId: string;
}

export interface ReverseTransferPayload {
  /** Refund correlation id. Sent as Idempotency-Key so repeats collapse. */
  refundCorrelationId: string;
  /** The original Mesh transfer to reverse. */
  meshTransferId: string;
  /** Amount to reverse (USDC 6-decimal units). Usually equals the original. */
  amountUsdcUnits: bigint;
}

export interface ReverseTransferResult {
  /** Mesh's id for the reversal transfer (opaque). */
  reverseTransferId: string;
}

export interface IMeshApiClient {
  connectMember(
    memberId: string,
    auth: MeshOAuthPayload,
  ): Promise<MeshConnectResult>;
  initiateTransfer(payload: InitiateTransferPayload): Promise<InitiateTransferResult>;
  /**
   * Initiates an on-chain reverse of a prior Mesh transfer (USDC moves from
   * the Bridge Liquid Address BACK to the member's connected wallet/CEX).
   * Mock impl: deterministic local response. Real impl: dormant until Mesh
   * sandbox onboarding completes; throws clearly if called.
   */
  reverseTransfer(payload: ReverseTransferPayload): Promise<ReverseTransferResult>;
}

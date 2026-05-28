// Outbound rail used to deliver USDC to the recipient.
export enum RailUsed {
  WALLET_CHAIN = 'WALLET_CHAIN', // direct on-chain USDC transfer
  CUSTODIAL = 'CUSTODIAL',       // via third-party crypto pay-out provider
}

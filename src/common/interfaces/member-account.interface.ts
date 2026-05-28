import { InboundPath } from '../enums/inbound-path.enum';

export interface IMemberAccount {
  memberId: string;
  bridgeLiquidAddress: string;
  bridgeCustomerId: string;
  usdcVirtualBalanceWei: bigint;
  ilsCollectionAccount: string | null;
  onrampProviderRef: string | null;
  preferredInboundPath: InboundPath;
  chainId: 1 | 8453;
  createdAt: Date;
  updatedAt: Date;
}

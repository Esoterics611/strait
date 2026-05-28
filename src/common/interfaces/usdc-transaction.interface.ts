import { Direction } from '../enums/direction.enum';
import { RailUsed } from '../enums/rail-used.enum';
import { SourceType } from '../enums/source-type.enum';
import { TxState } from '../enums/tx-state.enum';

export interface IUsdcTransaction {
  txId: string;
  memberId: string;
  sourceType: SourceType;
  meshTransferId: string | null;
  onrampPaymentId: string | null;
  ilsWireReference: string | null;
  bridgeTransferId: string | null;
  amountUsdcWei: bigint;
  amountIlsPrils: bigint | null;
  fxRateSnapshot: number | null;
  direction: Direction;
  state: TxState;
  idempotencyKey: string;
  onChainTxHash: string | null;
  railUsed: RailUsed | null;
  settledAt: Date | null;
  createdAt: Date;
}

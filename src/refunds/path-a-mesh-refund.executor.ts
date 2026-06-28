import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SourceType, TxState } from '@common/enums';
import { BusinessLogger } from '@common/logging';
import { IMeshApiClient, MESH_API_CLIENT } from '../mesh/mesh-api-client.interface';
import { ShadowLedgerService } from '../ledger/shadow-ledger.service';
import { StateMachineService } from '../state-machine/state-machine.service';
import type { IRefundExecutor, RefundJobClaim, RefundExecutionResult } from './refund-executor.types';

@Injectable()
export class PathAMeshRefundExecutor implements IRefundExecutor {
  readonly handlesSourceType = SourceType.MESH;
  private readonly blog = new BusinessLogger('PathAMeshRefundExecutor');

  constructor(
    @Inject(MESH_API_CLIENT) private readonly mesh: IMeshApiClient,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: ShadowLedgerService,
    private readonly sm: StateMachineService,
  ) {}

  async execute(job: RefundJobClaim): Promise<RefundExecutionResult> {
    const rows = await this.dataSource.query<{ mesh_transfer_id: string | null; member_id: string }[]>(
      `SELECT mesh_transfer_id, member_id FROM usdc_transactions WHERE tx_id = $1`,
      [job.txId],
    );
    const tx = rows[0];
    if (!tx) return { outcome: 'BLOCKED', blockedReason: 'tx_not_found' };
    if (!tx.mesh_transfer_id) return { outcome: 'BLOCKED', blockedReason: 'no_mesh_transfer_id' };

    let reverseTransferId: string;
    try {
      const result = await this.mesh.reverseTransfer({
        refundCorrelationId: job.jobId,
        meshTransferId: tx.mesh_transfer_id,
        amountUsdcUnits: job.amountUnits,
      });
      reverseTransferId = result.reverseTransferId;
    } catch (err) {
      this.blog.error('reverseTransfer', { txId: job.txId, detail: { jobId: job.jobId }, error: err });
      return { outcome: 'FAILED', errorMessage: (err as Error).message };
    }

    try {
      await this.ledger.creditUsdc(
        tx.member_id,
        job.amountUnits,
        SourceType.SELF,
        reverseTransferId,
        `refund:${job.jobId}`,
      );
      await this.sm.transition(job.txId, TxState.REFUNDED);
    } catch (err) {
      this.blog.error('refundLedgerTransition', { txId: job.txId, detail: { jobId: job.jobId }, error: err });
      return { outcome: 'FAILED', errorMessage: (err as Error).message };
    }

    this.blog.info('refundComplete', { txId: job.txId, detail: { jobId: job.jobId, reverseTransferId } });
    return { outcome: 'DONE', externalRefundId: reverseTransferId };
  }
}

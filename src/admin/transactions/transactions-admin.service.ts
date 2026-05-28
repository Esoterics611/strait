import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { BusinessLogger } from '@common/logging';
import { DataSource } from 'typeorm';
import { StateMachineService } from '../../state-machine/state-machine.service';
import { TxState, SourceType } from '@common/enums';
import { DualApprovalService } from '../approvals/dual-approval.service';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { AdminRole } from '../auth/jwt.service';
import { RefundJobsRepository } from './refund-jobs.repository';
import { IBridgeApiClient, BRIDGE_API_CLIENT } from '../../bridge/bridge-api-client.interface';

const REFUND_DUAL_APPROVAL_THRESHOLD = 100_000_000n; // $100
const FORCE_TRANSITION_ACTION = 'tx.force_transition';
const REFUND_ACTION = 'tx.refund';

@Injectable()
export class TransactionsAdminService {
  private readonly blog = new BusinessLogger('TransactionsAdminService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(BRIDGE_API_CLIENT) private readonly bridgeApi: IBridgeApiClient,
    private readonly stateMachine: StateMachineService,
    private readonly approvals: DualApprovalService,
    private readonly audit: AuditLogRepository,
    private readonly refunds: RefundJobsRepository,
  ) {
    this.approvals.register(FORCE_TRANSITION_ACTION, async (payload, approverId) =>
      this.runForceTransition(
        payload['txId'] as string,
        payload['toState'] as TxState,
        payload['reason'] as string,
        payload['initiatorId'] as string,
        approverId,
      ),
    );
    this.approvals.register(REFUND_ACTION, async (payload, approverId) =>
      this.runRefundEnqueue(
        payload['txId'] as string,
        BigInt(payload['amountUnits'] as string),
        payload['initiatorId'] as string,
        approverId,
        payload['executorPath'] as string,
      ),
    );
  }

  async list(filters: {
    state?: string;
    sourceType?: string;
    memberId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }) {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.state)      { where.push(`state = $${i++}`); params.push(filters.state); }
    if (filters.sourceType) { where.push(`source_type = $${i++}`); params.push(filters.sourceType); }
    if (filters.memberId)   { where.push(`member_id = $${i++}`); params.push(filters.memberId); }
    if (filters.from)       { where.push(`created_at >= $${i++}`); params.push(filters.from); }
    if (filters.to)         { where.push(`created_at <= $${i++}`); params.push(filters.to); }
    const limit = Math.min(filters.limit ?? 50, 500);
    const offset = filters.offset ?? 0;
    params.push(limit, offset);
    return this.dataSource.query(
      `SELECT tx_id, member_id, source_type, direction, amount_usdc_wei, state,
              idempotency_key, mesh_transfer_id, onramp_payment_id, ils_wire_reference,
              fx_rate_snapshot, created_at, settled_at
         FROM usdc_transactions
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
      params,
    );
  }

  async detail(txId: string) {
    const [tx, timeline, events, refunds] = await Promise.all([
      this.dataSource.query(`SELECT * FROM usdc_transactions WHERE tx_id = $1`, [txId]),
      this.timeline(txId),
      this.events(txId),
      this.refunds.listForTx(txId),
    ]);
    if (tx.length === 0) throw new NotFoundException('Tx not found');
    return { tx: tx[0], timeline, events, refunds };
  }

  async timeline(txId: string) {
    return this.dataSource.query(
      `SELECT id, from_state, to_state, metadata, occurred_at
         FROM tx_state_transitions
        WHERE tx_id = $1
        ORDER BY occurred_at ASC`,
      [txId],
    );
  }

  async events(txId: string) {
    return this.dataSource.query(
      `SELECT id, event_type, payload, occurred_at
         FROM domain_events_log
        WHERE tx_id = $1
        ORDER BY occurred_at ASC`,
      [txId],
    );
  }

  async cancel(txId: string, operatorId: string) {
    const current = await this.stateMachine.getCurrentState(txId);
    const cancellable = [
      TxState.MESH_PENDING,
      TxState.ILS_PENDING_ONRAMP,
      TxState.ILS_SWAP_PROCESSING,
      TxState.ILS_PENDING_COLLECTION,
      TxState.ILS_WIRE_CONFIRMED,
    ];
    if (!cancellable.includes(current)) {
      throw new Error(`Cannot cancel from state ${current}`);
    }
    await this.stateMachine.transition(txId, TxState.FAILED, {
      reason: 'admin_cancelled',
      operator: operatorId,
    });
    await this.audit.write({
      operatorId,
      action: 'tx.cancel',
      targetType: 'tx',
      targetId: txId,
    });
    return { ok: true };
  }

  /**
   * Force a state transition — emergency override. Requires compliance role,
   * a reason of >=20 chars, and dual approval. The transition row in
   * tx_state_transitions is marked with admin_override=true so audits can
   * find every forced row by metadata.
   */
  async requestForceTransition(
    txId: string,
    toState: TxState,
    reason: string,
    initiatorId: string,
    initiatorRole: AdminRole,
  ) {
    if (!reason || reason.length < 20) {
      throw new Error('Force transition requires a reason of at least 20 chars');
    }
    const approval = await this.approvals.request({
      action: FORCE_TRANSITION_ACTION,
      requiredRole: 'compliance',
      initiatedBy: initiatorId,
      initiatorRole,
      targetType: 'tx',
      targetId: txId,
      payload: { txId, toState, reason, initiatorId },
    });
    return { status: 'PENDING_APPROVAL', approvalId: approval.approval_id };
  }

  private async runForceTransition(
    txId: string,
    toState: TxState,
    reason: string,
    initiatorId: string,
    approverId: string,
  ): Promise<Record<string, unknown>> {
    // Direct insert — bypass StateMachineService.transition validation by going to
    // tx_state_transitions directly. This is the only allowed bypass and is
    // recorded with admin_override=true in metadata so audits can find them.
    const current = await this.stateMachine.getCurrentState(txId);
    await this.dataSource.query(
      `INSERT INTO tx_state_transitions(id, tx_id, from_state, to_state, metadata, occurred_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
      [
        txId,
        current,
        toState,
        JSON.stringify({
          admin_override: true,
          reason,
          initiatorId,
          approverId,
        }),
      ],
    );
    this.blog.error('forceTransition', {
      txId,
      detail: {
        category: 'admin_force_transition',
        from: current,
        to: toState,
        reason,
        initiatorId,
        approverId,
      },
    });
    await this.audit.write({
      operatorId: approverId,
      action: 'tx.force_transition',
      targetType: 'tx',
      targetId: txId,
      metadata: { from: current, to: toState, reason, initiatorId },
    });
    return { txId, fromState: current, toState };
  }

  /**
   * Refund: < $100 → queue immediately (single-approval); ≥ $100 → dual-approval queue.
   * Either way, transitions the tx to REFUND_QUEUED via StateMachineService and inserts
   * into refund_jobs. Per-path executor workers are Session 9+.
   */
  async requestRefund(
    txId: string,
    initiatorId: string,
    initiatorRole: AdminRole,
  ) {
    const rows = await this.dataSource.query<{ amount_usdc_wei: string; source_type: SourceType }[]>(
      `SELECT amount_usdc_wei, source_type FROM usdc_transactions WHERE tx_id = $1`,
      [txId],
    );
    if (rows.length === 0) throw new NotFoundException('Tx not found');
    const amount = BigInt(rows[0].amount_usdc_wei);
    const executorPath = inferExecutorPath(rows[0].source_type);

    if (amount < REFUND_DUAL_APPROVAL_THRESHOLD) {
      const result = await this.runRefundEnqueue(
        txId,
        amount,
        initiatorId,
        initiatorId,
        executorPath,
      );
      return { status: 'QUEUED', ...result };
    }
    const approval = await this.approvals.request({
      action: REFUND_ACTION,
      requiredRole: 'compliance',
      initiatedBy: initiatorId,
      initiatorRole,
      targetType: 'tx',
      targetId: txId,
      payload: {
        txId,
        amountUnits: amount.toString(),
        initiatorId,
        executorPath,
      },
    });
    return { status: 'PENDING_APPROVAL', approvalId: approval.approval_id };
  }

  private async runRefundEnqueue(
    txId: string,
    amountUnits: bigint,
    initiatorId: string,
    approverId: string,
    executorPath: string,
  ): Promise<Record<string, unknown>> {
    const current = await this.stateMachine.getCurrentState(txId);
    if (current !== TxState.REFUND_QUEUED) {
      // Allowed predecessors per state machine: FAILED, FAILED_BRIDGE → REFUND_QUEUED.
      if ([TxState.FAILED, TxState.FAILED_BRIDGE].includes(current)) {
        await this.stateMachine.transition(txId, TxState.REFUND_QUEUED, {
          initiatorId,
          approverId,
        });
      } else {
        this.blog.warn('refund', {
          txId,
          detail: {
            outcome: 'queued_without_state_transition',
            currentState: current,
          },
        });
      }
    }
    const { row, created } = await this.refunds.enqueue(
      txId,
      initiatorId,
      amountUnits,
      executorPath,
    );
    await this.audit.write({
      operatorId: approverId,
      action: 'tx.refund_queued',
      targetType: 'tx',
      targetId: txId,
      metadata: { jobId: row.job_id, amountUnits: amountUnits.toString(), executorPath },
    });
    return { jobId: row.job_id, created, executorPath };
  }

  async refreshProvider(txId: string, operatorId: string) {
    const rows = await this.dataSource.query<
      { source_type: SourceType; bridge_transfer_id: string | null }[]
    >(
      `SELECT source_type, bridge_transfer_id FROM usdc_transactions WHERE tx_id = $1`,
      [txId],
    );
    if (rows.length === 0) throw new NotFoundException('Tx not found');
    const tx = rows[0];
    let provider: Record<string, unknown> = { note: 'no provider data available for this source_type yet' };
    if (tx.bridge_transfer_id && typeof (this.bridgeApi as unknown as { getTransfer?: (id: string) => Promise<unknown> }).getTransfer === 'function') {
      try {
        provider = (await (this.bridgeApi as unknown as { getTransfer: (id: string) => Promise<Record<string, unknown>> }).getTransfer(
          tx.bridge_transfer_id,
        )) ?? {};
      } catch (err) {
        provider = { error: (err as Error).message };
      }
    }
    await this.audit.write({
      operatorId,
      action: 'tx.refresh_provider',
      targetType: 'tx',
      targetId: txId,
      metadata: { source_type: tx.source_type, bridge_transfer_id: tx.bridge_transfer_id },
    });
    return { provider };
  }
}

function inferExecutorPath(sourceType: SourceType): string {
  switch (sourceType) {
    case SourceType.MESH: return 'MESH_REVERSE';
    case SourceType.ONRAMP_RAPYD: return 'RAPYD_REFUND';
    case SourceType.ONRAMP_BOG:   return 'BOG_REFUND';
    case SourceType.SELF_ONRAIL:  return 'PATHC_ILS_WIRE_OUT';
  }
}

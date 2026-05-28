import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AdminRole } from '../auth/jwt.service';
import { BusinessLogger } from '@common/logging';
import { roleAtLeast } from '../auth/role.guard';
import {
  PendingApprovalRepository,
  PendingApprovalRow,
} from './pending-approval.repository';
import { AuditLogRepository } from '../audit/audit-log.repository';

export type ApprovalHandler = (
  payload: Record<string, unknown>,
  approverId: string,
) => Promise<Record<string, unknown>>;

/**
 * Generic dual-approval pipeline. Initiator calls `request()` → a PendingApproval
 * row is created with the captured payload. A second operator with the required
 * role calls `approve()` → the registered handler runs with the captured payload
 * and the approver's id; the result is recorded back into the approval row.
 *
 * Idempotency: handlers should use the approval_id as the idempotency key so the
 * approver's request and the initiator's intent collapse to one outcome.
 */
@Injectable()
export class DualApprovalService {
  private readonly blog = new BusinessLogger('DualApprovalService');
  private readonly handlers = new Map<string, ApprovalHandler>();

  constructor(
    private readonly approvals: PendingApprovalRepository,
    private readonly audit: AuditLogRepository,
  ) {}

  /** Modules register their action handlers at boot. */
  register(action: string, handler: ApprovalHandler): void {
    this.handlers.set(action, handler);
  }

  async request(input: {
    action: string;
    requiredRole: AdminRole;
    initiatedBy: string;
    initiatorRole: AdminRole;
    targetType?: string | null;
    targetId?: string | null;
    payload: Record<string, unknown>;
  }): Promise<PendingApprovalRow> {
    if (!this.handlers.has(input.action)) {
      throw new Error(`No handler registered for action=${input.action}`);
    }
    const row = await this.approvals.create({
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      initiatedBy: input.initiatedBy,
      requiredRole: input.requiredRole,
      payload: input.payload,
    });
    await this.audit.write({
      operatorId: input.initiatedBy,
      action: `approval_requested:${input.action}`,
      targetType: input.targetType ?? 'system',
      targetId: input.targetId ?? row.approval_id,
      metadata: { approval_id: row.approval_id, required_role: input.requiredRole },
    });
    this.blog.info('request', {
      detail: {
        approvalId: row.approval_id,
        action: input.action,
        initiatorId: input.initiatedBy,
        requiredRole: input.requiredRole,
        payloadKeys: Object.keys(input.payload),
      },
    });
    return row;
  }

  async approve(
    approvalId: string,
    approverId: string,
    approverRole: AdminRole,
    note?: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.approvals.findById(approvalId);
    if (!row) throw new NotFoundException('Approval not found');
    if (row.status !== 'PENDING') throw new ForbiddenException(`Approval is ${row.status}`);
    if (row.expires_at <= new Date()) throw new ForbiddenException('Approval expired');
    if (row.initiated_by === approverId) {
      this.blog.warn('approve', {
        detail: {
          approvalId,
          action: row.action,
          outcome: 'self_approve_rejected',
          initiatorId: row.initiated_by,
          approverId,
        },
      });
      throw new ForbiddenException('Initiator cannot self-approve');
    }
    if (!roleAtLeast(approverRole, row.required_role)) {
      throw new ForbiddenException(`Requires role: ${row.required_role}`);
    }

    const handler = this.handlers.get(row.action);
    if (!handler) throw new Error(`No handler registered for action=${row.action}`);

    const startedAt = Date.now();
    let result: Record<string, unknown>;
    try {
      result = await handler(row.payload, approverId);
    } catch (err) {
      await this.audit.write({
        operatorId: approverId,
        action: `approval_failed:${row.action}`,
        targetType: row.target_type ?? 'system',
        targetId: row.target_id ?? row.approval_id,
        metadata: { approval_id: row.approval_id, error: (err as Error).message },
      });
      throw err;
    }
    const ok = await this.approvals.resolve(approvalId, approverId, 'APPROVED', note ?? null, result);
    if (!ok) throw new ForbiddenException('Approval not actionable');
    await this.audit.write({
      operatorId: approverId,
      action: `approval_approved:${row.action}`,
      targetType: row.target_type ?? 'system',
      targetId: row.target_id ?? row.approval_id,
      metadata: { approval_id: row.approval_id },
    });
    this.blog.info('approve', {
      detail: {
        approvalId,
        action: row.action,
        approverId,
        outcome: 'executed',
      },
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  async reject(
    approvalId: string,
    approverId: string,
    approverRole: AdminRole,
    note: string,
  ): Promise<void> {
    const row = await this.approvals.findById(approvalId);
    if (!row) throw new NotFoundException('Approval not found');
    if (row.status !== 'PENDING') throw new ForbiddenException(`Approval is ${row.status}`);
    if (row.initiated_by === approverId) {
      throw new ForbiddenException('Initiator cannot self-reject — use cancel');
    }
    if (!roleAtLeast(approverRole, row.required_role)) {
      throw new ForbiddenException(`Requires role: ${row.required_role}`);
    }
    const ok = await this.approvals.resolve(approvalId, approverId, 'REJECTED', note);
    if (!ok) throw new ForbiddenException('Approval not actionable');
    await this.audit.write({
      operatorId: approverId,
      action: `approval_rejected:${row.action}`,
      targetType: row.target_type ?? 'system',
      targetId: row.target_id ?? row.approval_id,
      metadata: { approval_id: row.approval_id, note },
    });
    this.blog.info('reject', {
      detail: { approvalId, action: row.action, rejectorId: approverId, note },
    });
  }

  async cancel(approvalId: string, operatorId: string): Promise<void> {
    const row = await this.approvals.findById(approvalId);
    if (!row) throw new NotFoundException('Approval not found');
    if (row.initiated_by !== operatorId) {
      throw new ForbiddenException('Only the initiator can cancel');
    }
    const ok = await this.approvals.resolve(approvalId, operatorId, 'CANCELLED', 'cancelled by initiator');
    if (!ok) throw new ForbiddenException('Approval not actionable');
  }

  async listPending(role: AdminRole): Promise<PendingApprovalRow[]> {
    return this.approvals.listForRole(role);
  }

  async listHistory(limit = 100): Promise<PendingApprovalRow[]> {
    return this.approvals.listHistory(limit);
  }
}

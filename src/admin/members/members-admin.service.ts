import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ShadowLedgerService } from '../../ledger/shadow-ledger.service';
import { SourceType } from '@common/enums';
import { DualApprovalService } from '../approvals/dual-approval.service';
import { AuditLogRepository } from '../audit/audit-log.repository';
import { AdminRole } from '../auth/jwt.service';

const MANUAL_CREDIT_DUAL_APPROVAL_THRESHOLD = 100_000_000n; // $100 (6-decimal)

const MANUAL_CREDIT_ACTION = 'member.manual_credit';

@Injectable()
export class MembersAdminService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly ledger: ShadowLedgerService,
    private readonly approvals: DualApprovalService,
    private readonly audit: AuditLogRepository,
  ) {
    this.approvals.register(MANUAL_CREDIT_ACTION, async (payload, approverId) =>
      this.runManualCredit(
        payload['memberId'] as string,
        BigInt(payload['amountUnits'] as string),
        payload['reason'] as string,
        payload['initiatorId'] as string,
        approverId,
      ),
    );
  }

  async list(limit = 50, offset = 0, filters: { kyc?: string; path?: string } = {}) {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.kyc) { where.push(`kyc_status = $${i++}`); params.push(filters.kyc); }
    if (filters.path) { where.push(`preferred_inbound_path = $${i++}`); params.push(filters.path); }
    params.push(limit, offset);
    return this.dataSource.query(
      `SELECT member_id, email, phone, preferred_inbound_path, kyc_status, ofac_status,
              is_frozen, usdc_virtual_balance_wei, created_at
         FROM member_accounts
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY created_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
      params,
    );
  }

  async detail(memberId: string) {
    const rows = await this.dataSource.query(
      `SELECT * FROM member_accounts WHERE member_id = $1`,
      [memberId],
    );
    if (rows.length === 0) throw new NotFoundException('Member not found');
    return rows[0];
  }

  async ledgerRows(memberId: string, limit = 200) {
    return this.dataSource.query(
      `SELECT tx_id, source_type, direction, amount_usdc_wei, state, idempotency_key, created_at
         FROM usdc_transactions
        WHERE member_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [memberId, limit],
    );
  }

  async transactions(memberId: string, limit = 100) {
    return this.dataSource.query(
      `SELECT tx_id, source_type, direction, amount_usdc_wei, state, created_at
         FROM usdc_transactions
        WHERE member_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [memberId, limit],
    );
  }

  async setKyc(memberId: string, status: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED', operatorId: string) {
    const res = await this.dataSource.query<{ member_id: string }[]>(
      `UPDATE member_accounts
          SET kyc_status = $1,
              kyc_verified_at = CASE WHEN $1 = 'VERIFIED' THEN NOW() ELSE NULL END,
              updated_at = NOW()
        WHERE member_id = $2
        RETURNING member_id`,
      [status, memberId],
    );
    if (res.length === 0) throw new NotFoundException('Member not found');
    await this.audit.write({
      operatorId,
      action: 'member.kyc_status_changed',
      targetType: 'member',
      targetId: memberId,
      metadata: { status },
    });
    return { ok: true, kycStatus: status };
  }

  async freeze(memberId: string, reason: string, operatorId: string) {
    const res = await this.dataSource.query<{ member_id: string }[]>(
      `UPDATE member_accounts
          SET is_frozen = TRUE, frozen_at = NOW(), frozen_reason = $1, updated_at = NOW()
        WHERE member_id = $2 AND is_frozen = FALSE
        RETURNING member_id`,
      [reason, memberId],
    );
    if (res.length === 0) {
      throw new ConflictException('Already frozen or member not found');
    }
    await this.audit.write({
      operatorId,
      action: 'member.frozen',
      targetType: 'member',
      targetId: memberId,
      metadata: { reason },
    });
    return { ok: true };
  }

  async unfreeze(memberId: string, operatorId: string) {
    const res = await this.dataSource.query<{ member_id: string }[]>(
      `UPDATE member_accounts
          SET is_frozen = FALSE, frozen_at = NULL, frozen_reason = NULL, updated_at = NOW()
        WHERE member_id = $1 AND is_frozen = TRUE
        RETURNING member_id`,
      [memberId],
    );
    if (res.length === 0) {
      throw new ConflictException('Not frozen or member not found');
    }
    await this.audit.write({
      operatorId,
      action: 'member.unfrozen',
      targetType: 'member',
      targetId: memberId,
    });
    return { ok: true };
  }

  /**
   * Manual credit: small (<$100) executes immediately; larger goes through dual-approval.
   */
  async requestManualCredit(
    memberId: string,
    amountUnits: bigint,
    reason: string,
    initiatorId: string,
    initiatorRole: AdminRole,
  ) {
    if (amountUnits <= 0n) throw new Error('Amount must be positive');
    if (amountUnits < MANUAL_CREDIT_DUAL_APPROVAL_THRESHOLD) {
      const result = await this.runManualCredit(memberId, amountUnits, reason, initiatorId, initiatorId);
      return { status: 'EXECUTED', ...result };
    }
    const approval = await this.approvals.request({
      action: MANUAL_CREDIT_ACTION,
      requiredRole: 'compliance',
      initiatedBy: initiatorId,
      initiatorRole,
      targetType: 'member',
      targetId: memberId,
      payload: {
        memberId,
        amountUnits: amountUnits.toString(),
        reason,
        initiatorId,
      },
    });
    return { status: 'PENDING_APPROVAL', approvalId: approval.approval_id };
  }

  private async runManualCredit(
    memberId: string,
    amountUnits: bigint,
    reason: string,
    initiatorId: string,
    approverId: string,
  ): Promise<Record<string, unknown>> {
    const idempotencyKey = `admin-credit-${memberId}-${Date.now()}-${initiatorId.slice(0, 8)}`;
    const txId = await this.ledger.creditUsdc(
      memberId,
      amountUnits,
      SourceType.MESH,
      idempotencyKey,
      idempotencyKey,
      { admin_manual_credit: true, reason, initiatorId, approverId },
    );
    await this.audit.write({
      operatorId: approverId,
      action: 'member.manual_credit',
      targetType: 'member',
      targetId: memberId,
      metadata: { txId, amountUnits: amountUnits.toString(), reason, initiatorId },
    });
    return { txId, memberId, amountUnits: amountUnits.toString() };
  }
}

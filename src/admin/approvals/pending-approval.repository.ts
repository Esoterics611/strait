import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminRole } from '../auth/jwt.service';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CANCELLED';

export interface PendingApprovalRow {
  approval_id: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  initiated_by: string;
  required_role: AdminRole;
  payload: Record<string, unknown>;
  status: ApprovalStatus;
  resolved_by: string | null;
  resolution_note: string | null;
  result: Record<string, unknown> | null;
  expires_at: Date;
  created_at: Date;
  resolved_at: Date | null;
}

const TTL_HOURS = 24;

@Injectable()
export class PendingApprovalRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(input: {
    action: string;
    targetType: string | null;
    targetId: string | null;
    initiatedBy: string;
    requiredRole: AdminRole;
    payload: Record<string, unknown>;
  }): Promise<PendingApprovalRow> {
    const rows = await this.dataSource.query<PendingApprovalRow[]>(
      `INSERT INTO admin_pending_approvals
         (action, target_type, target_id, initiated_by, required_role, payload, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '${TTL_HOURS} hours')
       RETURNING *`,
      [
        input.action,
        input.targetType,
        input.targetId,
        input.initiatedBy,
        input.requiredRole,
        JSON.stringify(input.payload),
      ],
    );
    return rows[0];
  }

  async findById(id: string): Promise<PendingApprovalRow | null> {
    const rows = await this.dataSource.query<PendingApprovalRow[]>(
      `SELECT * FROM admin_pending_approvals WHERE approval_id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async listForRole(role: AdminRole): Promise<PendingApprovalRow[]> {
    return this.dataSource.query<PendingApprovalRow[]>(
      `SELECT * FROM admin_pending_approvals
       WHERE status = 'PENDING' AND required_role = $1 AND expires_at > NOW()
       ORDER BY created_at ASC`,
      [role],
    );
  }

  async listHistory(limit = 100): Promise<PendingApprovalRow[]> {
    return this.dataSource.query<PendingApprovalRow[]>(
      `SELECT * FROM admin_pending_approvals
       WHERE status <> 'PENDING'
       ORDER BY resolved_at DESC NULLS LAST
       LIMIT $1`,
      [limit],
    );
  }

  async resolve(
    id: string,
    resolvedBy: string,
    status: 'APPROVED' | 'REJECTED' | 'CANCELLED',
    note: string | null,
    result?: Record<string, unknown>,
  ): Promise<boolean> {
    const rows = await this.dataSource.query<{ approval_id: string }[]>(
      `UPDATE admin_pending_approvals
          SET status = $2, resolved_by = $3, resolution_note = $4, result = $5, resolved_at = NOW()
        WHERE approval_id = $1 AND status = 'PENDING' AND expires_at > NOW()
        RETURNING approval_id`,
      [id, status, resolvedBy, note, result ? JSON.stringify(result) : null],
    );
    return rows.length === 1;
  }

  async expireStale(): Promise<number> {
    const rows = await this.dataSource.query<{ approval_id: string }[]>(
      `UPDATE admin_pending_approvals
          SET status = 'EXPIRED', resolved_at = NOW()
        WHERE status = 'PENDING' AND expires_at <= NOW()
        RETURNING approval_id`,
    );
    return rows.length;
  }
}

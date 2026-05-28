import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export interface AuditLogInput {
  operatorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  payloadHash?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditLogRow {
  entry_id: string;
  operator_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload_hash: string | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  user_agent: string | null;
  occurred_at: Date;
}

@Injectable()
export class AuditLogRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async write(input: AuditLogInput): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO admin_audit_log
         (operator_id, action, target_type, target_id, payload_hash, metadata, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.operatorId,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.payloadHash ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ip ?? null,
        input.userAgent ?? null,
      ],
    );
  }

  async writeInTransaction(em: EntityManager, input: AuditLogInput): Promise<void> {
    await em.query(
      `INSERT INTO admin_audit_log
         (operator_id, action, target_type, target_id, payload_hash, metadata, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        input.operatorId,
        input.action,
        input.targetType,
        input.targetId ?? null,
        input.payloadHash ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ip ?? null,
        input.userAgent ?? null,
      ],
    );
  }

  async list(filters: {
    targetType?: string;
    targetId?: string;
    action?: string;
    operatorId?: string;
    from?: Date;
    to?: Date;
    limit?: number;
  }): Promise<AuditLogRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (filters.targetType) { where.push(`target_type = $${i++}`); params.push(filters.targetType); }
    if (filters.targetId)   { where.push(`target_id   = $${i++}`); params.push(filters.targetId); }
    if (filters.action)     { where.push(`action      = $${i++}`); params.push(filters.action); }
    if (filters.operatorId) { where.push(`operator_id = $${i++}`); params.push(filters.operatorId); }
    if (filters.from)       { where.push(`occurred_at >= $${i++}`); params.push(filters.from); }
    if (filters.to)         { where.push(`occurred_at <= $${i++}`); params.push(filters.to); }
    const limit = Math.min(filters.limit ?? 200, 1000);
    return this.dataSource.query<AuditLogRow[]>(
      `SELECT * FROM admin_audit_log
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY occurred_at DESC
       LIMIT ${limit}`,
      params,
    );
  }
}

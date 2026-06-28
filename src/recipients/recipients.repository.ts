import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RecipientPayoutMethod, RecipientRow } from './recipient.types';

interface CreateInput {
  memberid: string;
  displayName: string;
  relationship: string | null;
  payoutMethod: RecipientPayoutMethod;
  walletChainId?: number;
  walletAddress?: string;
  custodialProvider?: string;
  custodialExternalId?: string;
  custodialLast4?: string;
  dispatchStatus: string;
}

@Injectable()
export class RecipientsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(input: CreateInput): Promise<RecipientRow> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `INSERT INTO recipients
         (member_id, display_name, relationship, payout_method,
          wallet_chain_id, wallet_address,
          custodial_provider, custodial_external_id, custodial_last4,
          dispatch_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        input.memberid,
        input.displayName,
        input.relationship,
        input.payoutMethod,
        input.walletChainId ?? null,
        input.walletAddress ?? null,
        input.custodialProvider ?? null,
        input.custodialExternalId ?? null,
        input.custodialLast4 ?? null,
        input.dispatchStatus,
      ],
    );
    return rows[0];
  }

  async listByOwner(memberid: string): Promise<RecipientRow[]> {
    return this.dataSource.query<RecipientRow[]>(
      `SELECT * FROM recipients WHERE member_id = $1 ORDER BY created_at DESC`,
      [memberid],
    );
  }

  async findForOwner(recipientId: string, memberid: string): Promise<RecipientRow | null> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `SELECT * FROM recipients WHERE recipient_id = $1 AND member_id = $2 LIMIT 1`,
      [recipientId, memberid],
    );
    return rows[0] ?? null;
  }

  async findById(recipientId: string): Promise<RecipientRow | null> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `SELECT * FROM recipients WHERE recipient_id = $1 LIMIT 1`,
      [recipientId],
    );
    return rows[0] ?? null;
  }

  async updateDisplay(
    recipientId: string,
    fields: { displayName?: string; relationship?: string | null },
  ): Promise<RecipientRow> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `UPDATE recipients SET
         display_name  = COALESCE($2, display_name),
         relationship  = COALESCE($3, relationship)
       WHERE recipient_id = $1
       RETURNING *`,
      [recipientId, fields.displayName ?? null, fields.relationship ?? null],
    );
    return rows[0];
  }

  async setDispatchStatus(
    recipientId: string,
    status: string,
    error: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE recipients SET dispatch_status = $2, dispatch_error = $3 WHERE recipient_id = $1`,
      [recipientId, status, error],
    );
  }

  async isReferencedByTransfers(recipientId: string): Promise<boolean> {
    const rows = await this.dataSource.query<{ n: string }[]>(
      `SELECT COUNT(*)::text AS n FROM usdc_transactions WHERE recipient_id = $1`,
      [recipientId],
    );
    return parseInt(rows[0].n, 10) > 0;
  }

  async hardDelete(recipientId: string): Promise<void> {
    await this.dataSource.query(
      `DELETE FROM recipients WHERE recipient_id = $1`,
      [recipientId],
    );
  }

  async lockedTxIdsForRecipient(recipientId: string): Promise<string[]> {
    const rows = await this.dataSource.query<{ tx_id: string }[]>(
      `SELECT u.tx_id
         FROM usdc_transactions u
         LEFT JOIN v_tx_current_state v ON v.tx_id = u.tx_id
        WHERE u.recipient_id = $1
          AND u.direction = 'CREDIT'
          AND COALESCE(v.current_state, u.state) = 'USDC_LOCKED'`,
      [recipientId],
    );
    return rows.map((r) => r.tx_id);
  }
}

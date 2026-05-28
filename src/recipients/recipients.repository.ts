import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type {
  BridgeStatus,
  PayoutMethod,
  RecipientRow,
} from './recipient.types';

interface CreateInput {
  ownerMemberId: string;
  displayName: string;
  relationship: string | null;
  payoutMethod: PayoutMethod;
  bankAccountLast4: string;
  bankRoutingLast4: string;
  bankToken: string;
}

@Injectable()
export class RecipientsRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async create(input: CreateInput): Promise<RecipientRow> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `INSERT INTO recipients
         (owner_member_id, display_name, relationship, payout_method,
          bank_account_last4, bank_routing_last4, bank_token, bridge_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'REGISTERING')
       RETURNING *`,
      [
        input.ownerMemberId,
        input.displayName,
        input.relationship,
        input.payoutMethod,
        input.bankAccountLast4,
        input.bankRoutingLast4,
        input.bankToken,
      ],
    );
    return rows[0];
  }

  async listByOwner(ownerMemberId: string): Promise<RecipientRow[]> {
    return this.dataSource.query<RecipientRow[]>(
      `SELECT * FROM recipients
         WHERE owner_member_id = $1
         ORDER BY created_at DESC`,
      [ownerMemberId],
    );
  }

  async findForOwner(
    recipientId: string,
    ownerMemberId: string,
  ): Promise<RecipientRow | null> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `SELECT * FROM recipients
         WHERE recipient_id = $1 AND owner_member_id = $2 LIMIT 1`,
      [recipientId, ownerMemberId],
    );
    return rows[0] ?? null;
  }

  // Internal — used by the dispatch path via usdc_transactions.recipient_id
  // (NOT owner-scoped; the tx row already proves ownership).
  async findById(recipientId: string): Promise<RecipientRow | null> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `SELECT * FROM recipients WHERE recipient_id = $1 LIMIT 1`,
      [recipientId],
    );
    return rows[0] ?? null;
  }

  async findByOwnerAndBankToken(
    ownerMemberId: string,
    bankToken: string,
  ): Promise<RecipientRow | null> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `SELECT * FROM recipients
         WHERE owner_member_id = $1 AND bank_token = $2 LIMIT 1`,
      [ownerMemberId, bankToken],
    );
    return rows[0] ?? null;
  }

  async updateDisplay(
    recipientId: string,
    fields: {
      displayName?: string;
      relationship?: string | null;
      payoutMethod?: PayoutMethod;
    },
  ): Promise<RecipientRow> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `UPDATE recipients SET
         display_name  = COALESCE($2, display_name),
         relationship  = COALESCE($3, relationship),
         payout_method = COALESCE($4, payout_method),
         updated_at    = NOW()
       WHERE recipient_id = $1
       RETURNING *`,
      [
        recipientId,
        fields.displayName ?? null,
        fields.relationship ?? null,
        fields.payoutMethod ?? null,
      ],
    );
    return rows[0];
  }

  async applyBankChange(
    recipientId: string,
    bankAccountLast4: string,
    bankRoutingLast4: string,
    bankToken: string,
  ): Promise<RecipientRow> {
    const rows = await this.dataSource.query<RecipientRow[]>(
      `UPDATE recipients SET
         bank_account_last4 = $2,
         bank_routing_last4 = $3,
         bank_token         = $4,
         bridge_status      = 'REGISTERING',
         bridge_last_error  = NULL,
         updated_at         = NOW()
       WHERE recipient_id = $1
       RETURNING *`,
      [recipientId, bankAccountLast4, bankRoutingLast4, bankToken],
    );
    return rows[0];
  }

  async setRegistered(
    recipientId: string,
    refs: {
      customerRef: string;
      liquidationAddress: string;
      externalAccountId: string;
    },
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE recipients SET
         bridge_status              = 'READY',
         bridge_customer_ref        = $2,
         bridge_liquidation_address = $3,
         bridge_external_account_id = $4,
         bridge_last_error          = NULL,
         updated_at                 = NOW()
       WHERE recipient_id = $1`,
      [
        recipientId,
        refs.customerRef,
        refs.liquidationAddress,
        refs.externalAccountId,
      ],
    );
  }

  async setStatus(
    recipientId: string,
    status: BridgeStatus,
    error: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE recipients SET bridge_status = $2, bridge_last_error = $3,
              updated_at = NOW()
         WHERE recipient_id = $1`,
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

  // Re-drive support: tx ids whose CURRENT state is USDC_LOCKED for a
  // recipient (current state = latest transition, else the initial state).
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

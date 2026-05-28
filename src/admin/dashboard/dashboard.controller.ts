import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AdminRoleGuard, RequireRole } from '../auth/role.guard';

@Controller('admin')
@UseGuards(AdminRoleGuard)
export class DashboardController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Get('dashboard')
  @RequireRole('viewer')
  async dashboard() {
    const [
      todayTxs,
      dispatchedToday,
      settleRate,
      medianLatency,
      stuckCount,
      failedWebhooks,
      recentTxs,
      pendingApprovals,
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT COUNT(*) AS n FROM usdc_transactions WHERE created_at::date = CURRENT_DATE`,
      ),
      this.dataSource.query(
        `SELECT COALESCE(SUM(amount_usdc_wei::numeric),0) AS amount
           FROM usdc_transactions u
           JOIN tx_state_transitions t ON t.tx_id = u.tx_id
          WHERE t.to_state = 'BRIDGE_DISPATCHED' AND t.occurred_at::date = CURRENT_DATE`,
      ),
      this.dataSource.query(
        `SELECT
            (COUNT(*) FILTER (WHERE state = 'SETTLED_USD'))::float
            / NULLIF(COUNT(*),0) AS rate
           FROM usdc_transactions WHERE created_at > NOW() - INTERVAL '7 days'`,
      ),
      this.dataSource.query(
        `SELECT percentile_disc(0.5) WITHIN GROUP (
            ORDER BY EXTRACT(EPOCH FROM (a.settled_at - a.locked_at))
          ) AS median_seconds
         FROM (
           SELECT u.tx_id,
                  MIN(t.occurred_at) FILTER (WHERE t.to_state = 'USDC_LOCKED')   AS locked_at,
                  MIN(t.occurred_at) FILTER (WHERE t.to_state = 'SETTLED_USD')  AS settled_at
             FROM usdc_transactions u
             JOIN tx_state_transitions t ON t.tx_id = u.tx_id
            WHERE u.created_at > NOW() - INTERVAL '7 days'
            GROUP BY u.tx_id
         ) a
         WHERE a.settled_at IS NOT NULL`,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS n
           FROM tx_state_transitions
          WHERE to_state = 'BRIDGE_DISPATCHED' AND occurred_at < NOW() - INTERVAL '30 minutes'
            AND tx_id NOT IN (
              SELECT tx_id FROM tx_state_transitions
               WHERE to_state IN ('SETTLED_USD','FAILED_BRIDGE')
            )`,
      ),
      this.dataSource.query(`SELECT COUNT(*) AS n FROM failed_webhooks`),
      this.dataSource.query(
        `SELECT tx_id, source_type, state, amount_usdc_wei, created_at
           FROM usdc_transactions ORDER BY created_at DESC LIMIT 20`,
      ),
      this.dataSource.query(
        `SELECT COUNT(*) AS n FROM admin_pending_approvals WHERE status = 'PENDING' AND expires_at > NOW()`,
      ),
    ]);
    return {
      kpis: {
        todayTxCount: parseInt(todayTxs[0]?.n ?? '0', 10),
        todayDispatchedUnits: dispatchedToday[0]?.amount ?? '0',
        settleRate: settleRate[0]?.rate ?? null,
        medianSettleSeconds: medianLatency[0]?.median_seconds ?? null,
        stuckDispatchCount: parseInt(stuckCount[0]?.n ?? '0', 10),
        failedWebhookCount: parseInt(failedWebhooks[0]?.n ?? '0', 10),
        pendingApprovalCount: parseInt(pendingApprovals[0]?.n ?? '0', 10),
      },
      recentTxs,
    };
  }

  @Get('health')
  @RequireRole('viewer')
  async health() {
    try {
      await this.dataSource.query('SELECT 1');
      return { db: 'ok' };
    } catch (err) {
      return { db: 'fail', error: (err as Error).message };
    }
  }
}

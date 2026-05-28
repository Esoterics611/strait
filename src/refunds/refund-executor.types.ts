import { SourceType } from '@common/enums';

/**
 * Per-path refund executors all implement this contract. Each takes a claimed
 * QUEUED refund_jobs row and performs the *compensating* money movement for
 * its path (Mesh on-chain reverse, Rapyd refund API, Path-C IL wire-out).
 *
 * Outcomes are explicit:
 *   - DONE     ⇒ the compensating action succeeded AND the ledger reversal +
 *                tx state transition to REFUNDED have committed.
 *   - BLOCKED  ⇒ a known-irrecoverable condition (e.g. terminal already
 *                REFUNDED, original payment never settled). The job is parked
 *                — no retry — and a human must intervene.
 *   - FAILED   ⇒ a transient error (network, provider 5xx). The cron will
 *                retry with exponential backoff up to `maxAttempts`.
 */
export type RefundOutcomeKind = 'DONE' | 'BLOCKED' | 'FAILED';

export interface RefundExecutionResult {
  outcome: RefundOutcomeKind;
  /** Optional opaque id from the upstream provider (e.g. Rapyd refund id). */
  externalRefundId?: string;
  /** When FAILED — the error message to surface in refund_jobs.last_error. */
  errorMessage?: string;
  /** When BLOCKED — short reason persisted in refund_jobs.last_error. */
  blockedReason?: string;
}

export interface RefundJobClaim {
  jobId: string;
  txId: string;
  amountUnits: bigint;
  executorPath: string;
  attempts: number;
  requestedBy: string | null;
}

export interface IRefundExecutor {
  /** The SourceType this executor handles (one of MESH / ONRAMP_RAPYD / ONRAMP_BOG / SELF_ONRAIL). */
  readonly handlesSourceType: SourceType;
  execute(job: RefundJobClaim): Promise<RefundExecutionResult>;
}

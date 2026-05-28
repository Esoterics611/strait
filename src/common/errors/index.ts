export class InsufficientBalanceError extends Error {
  constructor(memberId: string, required: bigint, available: bigint) {
    super(
      `Member ${memberId}: required ${required} units but balance is ${available}`,
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(txId: string, from: string, to: string) {
    super(`Transition ${from} → ${to} is not allowed for tx ${txId}`);
    this.name = 'InvalidTransitionError';
  }
}

export class TransactionNotFoundError extends Error {
  constructor(txId: string) {
    super(`Transaction ${txId} not found`);
    this.name = 'TransactionNotFoundError';
  }
}

export class MemberFrozenError extends Error {
  constructor(memberId: string) {
    super(`Member ${memberId} is frozen — admin must unfreeze before any new tx`);
    this.name = 'MemberFrozenError';
  }
}

/**
 * S-B3 — enforced at the path-entrypoint INSERTs (MeshService.initiateTransfer,
 * OnRampOrchestrator.handlePaymentReceived, ILSCollectionService.attributeWire).
 * Post-cutover, every new outbound transfer MUST name a recipient so the
 * dispatch listener pays a real third party — not the sender's own Bridge id.
 * The DB column `usdc_transactions.recipient_id` stays nullable for historical
 * rows; the discipline is service-level.
 */
export class TransferRequiresRecipientError extends Error {
  constructor(memberId: string, sourceType?: string) {
    super(
      `Transfer initiation by ${memberId}${sourceType ? ` (${sourceType})` : ''} requires a recipient_id — select a recipient before retrying.`,
    );
    this.name = 'TransferRequiresRecipientError';
  }
}

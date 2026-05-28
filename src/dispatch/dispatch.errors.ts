export class DispatchError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DispatchError';
  }
}

export class UnsupportedPayoutMethodError extends Error {
  constructor(method: string) {
    super(`No dispatcher registered for payout method: ${method}`);
    this.name = 'UnsupportedPayoutMethodError';
  }
}

export class RecipientNotReadyError extends Error {
  constructor(recipientId: string, dispatchStatus: string) {
    super(`Recipient ${recipientId} not ready for dispatch (status=${dispatchStatus})`);
    this.name = 'RecipientNotReadyError';
  }
}

export class UnsupportedChainError extends Error {
  constructor(chainId: number) {
    super(`Unsupported chain id: ${chainId}`);
    this.name = 'UnsupportedChainError';
  }
}

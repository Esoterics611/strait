export class BlockedAddressError extends Error {
  constructor(public readonly address: string, public readonly reason: string) {
    // We intentionally do NOT echo the address into the message — keep it on
    // a typed field so logs can redact at the formatter, not by accident.
    super('OFAC screen blocked transfer');
    this.name = 'BlockedAddressError';
  }
}

export class MeshApiError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`Mesh API ${status}: ${body}`);
    this.name = 'MeshApiError';
  }
}

export class InvalidConfirmationDepthError extends Error {
  constructor(
    public readonly chainId: number,
    public readonly required: number,
    public readonly observed: number,
  ) {
    super(
      `chain_id=${chainId} requires ${required} confirmations, observed ${observed}`,
    );
    this.name = 'InvalidConfirmationDepthError';
  }
}

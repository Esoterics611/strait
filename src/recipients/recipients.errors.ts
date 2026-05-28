export class RecipientNotFoundError extends Error {
  constructor(recipientId: string) {
    super(`Recipient not found: ${recipientId}`);
    this.name = 'RecipientNotFoundError';
  }
}

export class DuplicateRecipientError extends Error {
  constructor(readonly existingDisplayName: string) {
    super(`duplicate:${existingDisplayName}`);
    this.name = 'DuplicateRecipientError';
  }
}

export class RecipientRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipientRegistrationError';
  }
}

import {
  InsufficientBalanceError,
  InvalidTransitionError,
  MemberFrozenError,
  TransactionNotFoundError,
  TransferRequiresRecipientError,
} from '.';

describe('error classes', () => {
  it('InsufficientBalanceError carries member + required + available', () => {
    const e = new InsufficientBalanceError('m', 5n, 1n);
    expect(e.name).toBe('InsufficientBalanceError');
    expect(e.message).toContain('5');
    expect(e.message).toContain('1');
  });

  it('InvalidTransitionError carries tx + from + to', () => {
    const e = new InvalidTransitionError('t', 'A', 'B');
    expect(e.name).toBe('InvalidTransitionError');
    expect(e.message).toContain('A → B');
  });

  it('TransactionNotFoundError carries the txId', () => {
    const e = new TransactionNotFoundError('tx-x');
    expect(e.message).toContain('tx-x');
  });

  it('MemberFrozenError carries the memberId', () => {
    const e = new MemberFrozenError('m-1');
    expect(e.name).toBe('MemberFrozenError');
    expect(e.message).toContain('m-1');
  });

  it('TransferRequiresRecipientError carries member + source (S-B3)', () => {
    const e = new TransferRequiresRecipientError('m-1', 'MESH');
    expect(e.name).toBe('TransferRequiresRecipientError');
    expect(e.message).toContain('m-1');
    expect(e.message).toContain('MESH');
    expect(e.message).toContain('recipient_id');
  });
});

import { usdcDecimalToUnits, usdcUnitsToDecimal } from './usdc-decimal';

describe('usdcDecimalToUnits', () => {
  it('converts whole-number strings', () => {
    expect(usdcDecimalToUnits('1')).toBe(1_000_000n);
    expect(usdcDecimalToUnits('0')).toBe(0n);
    expect(usdcDecimalToUnits('10')).toBe(10_000_000n);
  });

  it('converts decimal strings with up to 6 fractional digits', () => {
    expect(usdcDecimalToUnits('10.5')).toBe(10_500_000n);
    expect(usdcDecimalToUnits('10.500000')).toBe(10_500_000n);
    expect(usdcDecimalToUnits('0.000001')).toBe(1n);
    expect(usdcDecimalToUnits('123.456789')).toBe(123_456_789n);
  });

  it('rejects more than 6 fractional digits', () => {
    expect(() => usdcDecimalToUnits('0.0000001')).toThrow(/6 fractional/);
    expect(() => usdcDecimalToUnits('1.1234567')).toThrow(/6 fractional/);
  });

  it('rejects non-numeric strings', () => {
    expect(() => usdcDecimalToUnits('abc')).toThrow(/not a numeric decimal/);
    expect(() => usdcDecimalToUnits('1.2.3')).toThrow(/not a numeric decimal/);
    expect(() => usdcDecimalToUnits('1e3')).toThrow(/not a numeric decimal/);
  });

  it('rejects empty / whitespace-only strings', () => {
    expect(() => usdcDecimalToUnits('')).toThrow(/empty string/);
    expect(() => usdcDecimalToUnits('   ')).toThrow(/empty string/);
  });

  it('handles negative values (refund / reversal contexts)', () => {
    expect(usdcDecimalToUnits('-1.5')).toBe(-1_500_000n);
  });
});

describe('usdcUnitsToDecimal', () => {
  it('formats whole-number units without a decimal point', () => {
    expect(usdcUnitsToDecimal(1_000_000n)).toBe('1');
    expect(usdcUnitsToDecimal(0n)).toBe('0');
  });

  it('formats fractional units with trailing zeros trimmed', () => {
    expect(usdcUnitsToDecimal(10_500_000n)).toBe('10.5');
    expect(usdcUnitsToDecimal(1n)).toBe('0.000001');
    expect(usdcUnitsToDecimal(123_456_789n)).toBe('123.456789');
  });

  it('round-trips via usdcDecimalToUnits', () => {
    for (const dec of ['0', '1', '10.5', '0.000001', '999999999.123456']) {
      expect(usdcUnitsToDecimal(usdcDecimalToUnits(dec))).toBe(dec);
    }
  });

  it('formats negatives', () => {
    expect(usdcUnitsToDecimal(-1_500_000n)).toBe('-1.5');
  });
});

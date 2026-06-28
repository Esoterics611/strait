// USDC has 6 decimal places. The on-the-wire representation from Mesh or any
// external provider is a decimal string (e.g. "10.500000"). Internally we
// store 6-decimal units as bigint (10.5 USDC === 10_500_000n).
//
// This util is the single source of truth for that conversion.

const USDC_UNIT_SCALE = 1_000_000n;

export function usdcDecimalToUnits(s: string): bigint {
  if (typeof s !== 'string') {
    throw new Error('usdcDecimalToUnits: input must be a string');
  }
  const trimmed = s.trim();
  if (trimmed.length === 0) {
    throw new Error('usdcDecimalToUnits: empty string');
  }
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`usdcDecimalToUnits: not a numeric decimal: "${s}"`);
  }
  const negative = trimmed.startsWith('-');
  const abs = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = abs.split('.');
  if (frac.length > 6) {
    throw new Error(
      `usdcDecimalToUnits: more than 6 fractional digits in "${s}"`,
    );
  }
  const fracPadded = (frac + '000000').slice(0, 6);
  const units = BigInt(whole) * USDC_UNIT_SCALE + BigInt(fracPadded || '0');
  return negative ? -units : units;
}

export function usdcUnitsToDecimal(n: bigint): string {
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / USDC_UNIT_SCALE;
  const frac = abs % USDC_UNIT_SCALE;
  if (frac === 0n) return `${negative ? '-' : ''}${whole.toString()}`;
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}.${fracStr}`;
}

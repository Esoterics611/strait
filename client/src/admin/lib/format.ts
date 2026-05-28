export function fmtUsdc(units: string | number | bigint | null | undefined): string {
  if (units == null) return '—';
  const n = typeof units === 'string' || typeof units === 'number' ? BigInt(units) : units;
  const sign = n < 0n ? '-' : '';
  const abs = n < 0n ? -n : n;
  const dollars = abs / 1_000_000n;
  const cents = (abs % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${sign}$${dollars.toLocaleString()}.${cents}`;
}

export function fmtTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function fmtRelative(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const delta = Math.round((Date.now() - d.getTime()) / 1000);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

export function explorerUrl(hash: string, chainId?: number): string {
  // chainId 1 = Ethereum mainnet → etherscan; chainId 8453 = Base → basescan.
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`;
  return `https://basescan.org/tx/${hash}`;
}

export function stateColor(state: string): string {
  if (state.endsWith('SETTLED_USD')) return 'bg-emerald-100 text-emerald-800';
  if (state.startsWith('FAILED')) return 'bg-rose-100 text-rose-800';
  if (state === 'REFUNDED') return 'bg-slate-200 text-slate-700';
  if (state.endsWith('PENDING') || state.endsWith('PENDING_ONRAMP') || state.endsWith('PROCESSING') || state.endsWith('PENDING_COLLECTION'))
    return 'bg-amber-100 text-amber-800';
  if (state === 'USDC_LOCKED' || state === 'BRIDGE_DISPATCHED' || state === 'ILS_WIRE_CONFIRMED')
    return 'bg-sky-100 text-sky-800';
  return 'bg-slate-100 text-slate-700';
}

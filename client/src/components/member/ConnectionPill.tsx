import type { ConnectionState } from '../../lib/contract';
import { useT } from '../../lib/i18n';

// Connection state as text + color (never color-only).
export function ConnectionPill({
  connection,
}: {
  connection: ConnectionState;
}): JSX.Element {
  const { t } = useT();
  const map: Record<ConnectionState, { key: 'conn.connecting' | 'conn.live' | 'conn.reconnecting' | 'conn.closed'; cls: string }> = {
    connecting: { key: 'conn.connecting', cls: 'bg-slate-100 text-slate-600' },
    live: { key: 'conn.live', cls: 'bg-emerald-100 text-emerald-700' },
    reconnecting: { key: 'conn.reconnecting', cls: 'bg-amber-100 text-amber-700' },
    closed: { key: 'conn.closed', cls: 'bg-rose-100 text-rose-700' },
  };
  const c = map[connection];
  return (
    <span
      role="status"
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${c.cls}`}
    >
      {t(c.key)}
    </span>
  );
}

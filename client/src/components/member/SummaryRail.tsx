import type { Quote } from '../../lib/contract';
import { fmtRate, useT } from '../../lib/i18n';
import { MoneyText, Skeleton } from './ui';

// The always-visible send/receive/fee/rate/ETA panel (Wise pattern).
// Shimmers only the changing figures while a fresh quote is in flight.
export function SummaryRail({
  quote,
  pending = false,
  error,
}: {
  quote: Quote | null;
  pending?: boolean;
  error?: string | null;
}): JSX.Element {
  const { t, lang } = useT();

  if (error) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        {error}
      </div>
    );
  }

  const Row = ({
    label,
    children,
  }: {
    label: string;
    children: React.ReactNode;
  }): JSX.Element => (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">
        {pending && !quote ? <Skeleton className="h-4 w-20" /> : children}
      </span>
    </div>
  );

  return (
    <div
      aria-live="polite"
      className={`rounded-2xl border border-slate-200 bg-white p-4 transition ${
        pending ? 'opacity-70' : ''
      }`}
    >
      <Row label={t('rail.youSend')}>
        {quote ? <MoneyText money={quote.send} bold /> : '—'}
      </Row>
      <Row label={t('rail.fee')}>
        {quote ? <MoneyText money={quote.fee} /> : '—'}
      </Row>
      <Row label={t('rail.rate')}>
        {quote ? t('rail.rateValue', { usd: fmtRate(quote.fxRate, lang) }) : '—'}
      </Row>
      <div className="my-1 h-px bg-slate-100" />
      <Row label={t('rail.theyGet')}>
        {quote ? (
          <MoneyText money={quote.receive} bold className="text-emerald-700" />
        ) : (
          '—'
        )}
      </Row>
      {quote && (
        <p className="mt-2 text-xs text-slate-500">{quote.etaText}</p>
      )}
    </div>
  );
}

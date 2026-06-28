import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useT, fmtDateTime, fmtRelative } from '../../lib/i18n';
import { api, payoutMethodLabelKey } from '../../lib/api';
import { stageFor, isTerminalStage } from '../../lib/state-labels';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  MoneyText,
  Skeleton,
  StatusBadge,
} from '../../components/member';
import { Stepper } from '../../components/member';
import { useAsync } from '../useAsync';
import type { Transfer, TransferListItem } from '../../lib/contract';

export function ActivityPage(): JSX.Element {
  const { t, lang } = useT();
  const [items, setItems] = useState<TransferListItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listTransfers({ limit: 10, cursor })
      .then((p) => {
        if (cancelled) return;
        setItems((prev) => (cursor ? [...prev, ...p.items] : p.items));
        setNextCursor(p.nextCursor);
      })
      .catch(() => !cancelled && setError(true))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [cursor]);

  const filtered = items.filter((i) =>
    i.recipientName.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-slate-900">
        {t('activity.title')}
      </h1>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('activity.search')}
        className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <div className="mt-4 space-y-2">
        {loading && items.length === 0 &&
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        {error && <ErrorState onRetry={() => setCursor(undefined)} />}
        {!loading && !error && filtered.length === 0 && (
          <EmptyState title={t('activity.empty')} />
        )}
        {filtered.map((tx) => (
          <Link key={tx.txId} to={`/activity/${tx.txId}`}>
            <Card className="flex items-center justify-between p-4 hover:border-slate-300">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">
                  {tx.recipientName}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  <MoneyText money={tx.send} /> · {fmtRelative(tx.createdAt, lang)}
                </p>
              </div>
              <StatusBadge state={tx.state} />
            </Card>
          </Link>
        ))}
        {nextCursor && (
          <div className="pt-2 text-center">
            <Button variant="secondary" onClick={() => setCursor(nextCursor)}>
              {t('activity.loadMore')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityDetailPage(): JSX.Element {
  const { t, lang } = useT();
  const { txId } = useParams<{ txId: string }>();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync<Transfer>(
    () => api.getTransfer(txId ?? ''),
    [txId],
  );

  if (loading)
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (error || !data)
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <ErrorState onRetry={reload} />
      </div>
    );

  const stage = stageFor(data.state);
  const terminal = isTerminalStage(stage);

  return (
    <div className="mx-auto max-w-xl px-4 py-8 print:py-2">
      <button
        onClick={() => nav('/activity')}
        className="text-sm text-brand-700 hover:underline print:hidden"
      >
        ← {t('activity.title')}
      </button>

      <Card className="mt-4 p-6">
        <h1 className="text-lg font-semibold text-slate-900">
          {t('activity.receipt')}
        </h1>
        <dl className="mt-4 space-y-2 text-sm">
          <Row k={t('wiz.review.to')}>
            {data.recipient.displayName} ·{' '}
            {t(payoutMethodLabelKey(data.recipient.payoutMethod))}
          </Row>
          <Row k={t('rail.youSend')}>
            <MoneyText money={data.quote.send} bold />
          </Row>
          <Row k={t('rail.fee')}>
            <MoneyText money={data.quote.fee} />
          </Row>
          <Row k={t('rail.theyGet')}>
            <MoneyText
              money={data.quote.receive}
              bold
              className="text-emerald-700"
            />
          </Row>
          <Row k={t('track.settledAt')}>{fmtDateTime(data.createdAt, lang)}</Row>
        </dl>
      </Card>

      <Card className="mt-4 p-6">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">
          {t('activity.timeline')}
        </h2>
        <Stepper current={stage} stalled={terminal && stage !== 'DONE'} />
      </Card>

      <div className="mt-6 flex gap-2 print:hidden">
        <Button variant="secondary" onClick={() => window.print()}>
          {t('track.saveReceipt')}
        </Button>
        <Button
          onClick={() =>
            nav('/send', {
              state: {
                recipientId: data.recipient.recipientId,
                amount: String(Number(data.quote.send.minor) / 100),
                payInMethod: data.quote.payInMethod,
                payOutMethod: data.quote.payOutMethod,
                gotoReview: true,
              },
            })
          }
        >
          {t('track.sendAgain')}
        </Button>
        <Link to={`/t/${data.txId}`} className="ms-auto self-center text-sm text-brand-700">
          {t('track.title')} →
        </Link>
      </div>
    </div>
  );
}

function Row({
  k,
  children,
}: {
  k: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900">{children}</dd>
    </div>
  );
}

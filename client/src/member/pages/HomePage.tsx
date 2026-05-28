import { Link, useNavigate } from 'react-router-dom';
import { useT, fmtRelative } from '../../lib/i18n';
import { api } from '../../lib/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  MoneyText,
  Skeleton,
  StatusBadge,
} from '../../components/member';
import { useMemberAuth } from '../MemberAuth';
import { useAsync } from '../useAsync';
import type { Recipient, TransferListItem } from '../../lib/contract';

export function HomePage(): JSX.Element {
  const { t, lang } = useT();
  const nav = useNavigate();
  const { member } = useMemberAuth();

  const recipients = useAsync<Recipient[]>(() => api.listRecipients(), []);
  const activity = useAsync(() => api.listTransfers({ limit: 5 }), []);

  const name = member?.displayName ? `, ${member.displayName}` : '';

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-slate-900">
        {t('home.greeting', { name })}
      </h1>

      <div className="mt-6">
        <Button full onClick={() => nav('/send')} className="h-14 text-base">
          {t('home.send')}
        </Button>
      </div>

      {member?.kycStatus === 'PENDING' && (
        <Link
          to="/profile"
          className="mt-4 block rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {t('home.kycNudge')}
        </Link>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium text-slate-500">{t('home.sendAgain')}</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {recipients.loading &&
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-32" />)}
          {recipients.data?.slice(0, 3).map((r) => (
            <button
              key={r.recipientId}
              onClick={() => nav('/send', { state: { recipientId: r.recipientId } })}
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-slate-300"
            >
              {r.displayName}
              {r.bridgeStatus === 'FAILED' && (
                <span
                  className="h-2 w-2 rounded-full bg-rose-500"
                  title={t('rcpt.failed', { name: r.displayName })}
                />
              )}
            </button>
          ))}
          {!recipients.loading && (recipients.data?.length ?? 0) === 0 && (
            <Link
              to="/recipients/new"
              className="rounded-full border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-brand-700"
            >
              {t('home.noRecipients')}
            </Link>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-slate-500">
          {t('home.recentActivity')}
        </h2>
        <div className="mt-3 space-y-2">
          {activity.loading &&
            [0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          {activity.error && (
            <ErrorState
              message={t('home.activityFailed')}
              onRetry={activity.reload}
            />
          )}
          {!activity.loading &&
            !activity.error &&
            activity.data?.items.length === 0 && (
              <EmptyState title={t('home.noTransfers')} />
            )}
          {activity.data?.items.map((tx) => (
            <ActivityRow key={tx.txId} tx={tx} relLang={lang} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ActivityRow({
  tx,
  relLang,
}: {
  tx: TransferListItem;
  relLang: 'en' | 'he';
}): JSX.Element {
  const { t } = useT();
  return (
    <Link
      to={`/activity/${tx.txId}`}
      aria-label={t('activity.row', {
        send: tx.recipientName,
        name: tx.recipientName,
        status: tx.state,
        rel: fmtRelative(tx.createdAt, relLang),
      })}
    >
      <Card className="flex items-center justify-between p-4 hover:border-slate-300">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">
            {tx.recipientName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            <MoneyText money={tx.send} /> · {fmtRelative(tx.createdAt, relLang)}
          </p>
        </div>
        <StatusBadge state={tx.state} />
      </Card>
    </Link>
  );
}

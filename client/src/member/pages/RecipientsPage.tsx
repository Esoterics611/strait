import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { api, ApiError } from '../../lib/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Segmented,
  Skeleton,
  TextInput,
  useToast,
} from '../../components/member';
import { useAsync } from '../useAsync';
import type {
  CreateRecipientReq,
  PayoutMethod,
  Recipient,
} from '../../lib/contract';

function routingValid(r: string): boolean {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split('').map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) +
    7 * (d[1] + d[4] + d[7]) +
    1 * (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

function BridgePill({ r }: { r: Recipient }): JSX.Element {
  const { t } = useT();
  if (r.bridgeStatus === 'READY')
    return <span className="text-xs font-medium text-emerald-700">●&nbsp;{t('rcpt.ready', { name: '' }).trim()}</span>;
  if (r.bridgeStatus === 'FAILED')
    return <span className="text-xs font-medium text-rose-700">●&nbsp;{t('rcpt.failed', { name: r.displayName })}</span>;
  return (
    <span className="text-xs font-medium text-amber-700">
      <span className="me-1 inline-block h-2 w-2 rounded-full bg-amber-500 motion-safe:animate-pulse" />
      {t('rcpt.submitting')}
    </span>
  );
}

export function RecipientsListPage(): JSX.Element {
  const { t } = useT();
  const list = useAsync<Recipient[]>(() => api.listRecipients(), []);

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-900">{t('rcpt.title')}</h1>
        <Link to="/recipients/new">
          <Button>{t('rcpt.add')}</Button>
        </Link>
      </div>

      <div className="mt-6 space-y-2">
        {list.loading &&
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        {list.error && <ErrorState onRetry={list.reload} />}
        {!list.loading && list.data?.length === 0 && (
          <EmptyState
            title={t('rcpt.empty')}
            action={
              <Link to="/recipients/new">
                <Button>{t('rcpt.addFirst')}</Button>
              </Link>
            }
          />
        )}
        {list.data?.map((r) => (
          <Link key={r.recipientId} to={`/recipients/${r.recipientId}`}>
            <Card className="flex items-center justify-between p-4 hover:border-slate-300">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {r.displayName}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {t('rcpt.maskedTo', { last4: r.bankAccountLast4 ?? '••••' })}
                </p>
              </div>
              <BridgePill r={r} />
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function RecipientFormPage(): JSX.Element {
  const { t } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const fromWizard = (loc.state as { fromWizard?: boolean } | null)?.fromWizard;

  const [displayName, setName] = useState('');
  const [relationship, setRel] = useState('');
  const [payoutMethod, setMethod] = useState<PayoutMethod>('BANK_RTP');
  const [account, setAccount] = useState('');
  const [routing, setRouting] = useState('');
  const [accountType, setType] = useState<'checking' | 'savings'>('checking');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const submit = async (): Promise<void> => {
    const e: Record<string, string> = {};
    if (!displayName.trim()) e.name = t('rcpt.err.name');
    if (!account.trim()) e.account = t('rcpt.err.account');
    if (!routingValid(routing)) e.routing = t('rcpt.err.routing');
    setErrors(e);
    if (Object.keys(e).length) return;

    const req: CreateRecipientReq = {
      displayName: displayName.trim(),
      relationship: relationship.trim() || undefined,
      payoutMethod,
      bank: { accountNumber: account.trim(), routingNumber: routing, accountType },
    };
    setSubmitting(true);
    try {
      const rec = await api.createRecipient(req);
      toast.show(t('rcpt.registering', { name: rec.displayName }));
      if (fromWizard) {
        nav('/send', { state: { recipientId: rec.recipientId }, replace: true });
      } else {
        nav(`/recipients/${rec.recipientId}`, { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DUPLICATE') {
        setErrors({
          account: t('rcpt.duplicate', { name: err.message.split(':')[1] ?? '' }),
        });
      } else {
        setErrors({ form: t('common.somethingWrong') });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <h1 className="text-xl font-semibold text-slate-900">{t('rcpt.add')}</h1>
      <div className="mt-6 space-y-4">
        <TextInput
          label={t('rcpt.displayName')}
          value={displayName}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <TextInput
          label={t('rcpt.relationship')}
          value={relationship}
          onChange={(e) => setRel(e.target.value)}
        />
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">
            {t('rcpt.payoutMethod')}
          </p>
          <Segmented<PayoutMethod>
            ariaLabel={t('rcpt.payoutMethod')}
            value={payoutMethod}
            onChange={setMethod}
            options={[
              { value: 'BANK_RTP', label: 'RTP' },
              { value: 'BANK_FEDNOW', label: 'FedNow' },
              { value: 'BANK_ACH', label: 'ACH' },
            ]}
          />
        </div>
        <TextInput
          label={t('rcpt.bank.account')}
          numeric
          value={account}
          onChange={(e) => setAccount(e.target.value.replace(/\D/g, ''))}
          error={errors.account}
        />
        <TextInput
          label={t('rcpt.bank.routing')}
          numeric
          value={routing}
          onChange={(e) => setRouting(e.target.value.replace(/\D/g, '').slice(0, 9))}
          error={errors.routing}
        />
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">
            {t('rcpt.bank.type')}
          </p>
          <Segmented<'checking' | 'savings'>
            ariaLabel={t('rcpt.bank.type')}
            value={accountType}
            onChange={setType}
            options={[
              { value: 'checking', label: t('rcpt.bank.checking') },
              { value: 'savings', label: t('rcpt.bank.savings') },
            ]}
          />
        </div>

        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {t('rcpt.trust')}
        </p>
        {errors.form && <p className="text-xs text-rose-600">{errors.form}</p>}

        <Button full loading={submitting} onClick={submit}>
          {submitting ? t('rcpt.submitting') : t('action.continue')}
        </Button>
      </div>
    </div>
  );
}

export function RecipientDetailPage(): JSX.Element {
  const { t } = useT();
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [rec, setRec] = useState<Recipient | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attempt = 0;

    const tick = (): void => {
      if (!id) return;
      api
        .getRecipient(id)
        .then((r) => {
          if (cancelled) return;
          setRec(r);
          if (r.bridgeStatus === 'REGISTERING' || r.bridgeStatus === 'UNREGISTERED') {
            const delay = Math.min(5000, 800 * 2 ** attempt++);
            pollRef.current = setTimeout(tick, delay);
          }
        })
        .catch(() => {
          if (!cancelled) setLoadErr(true);
        });
    };
    tick();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [id]);

  if (loadErr) return <div className="p-8"><ErrorState /></div>;
  if (!rec)
    return (
      <div className="mx-auto max-w-md px-4 py-8">
        <Skeleton className="h-40 w-full" />
      </div>
    );

  const retry = async (): Promise<void> => {
    if (!id) return;
    const updated = await api.updateRecipient(id, {
      bank: {
        accountNumber: `0000${rec.bankAccountLast4 ?? '0000'}`,
        routingNumber: '021000021',
        accountType: 'checking',
      },
    });
    setRec(updated);
  };

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <button
        onClick={() => nav('/recipients')}
        className="text-sm text-brand-700 hover:underline"
      >
        ← {t('rcpt.title')}
      </button>
      <Card className="mt-4 p-5">
        <h1 className="text-lg font-semibold text-slate-900">{rec.displayName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('rcpt.maskedTo', { last4: rec.bankAccountLast4 ?? '••••' })}
        </p>
        <div className="mt-4">
          <BridgePill r={rec} />
        </div>
        {rec.bridgeStatus === 'REGISTERING' && (
          <p className="mt-3 text-sm text-amber-700">
            {t('rcpt.registering', { name: rec.displayName })}
          </p>
        )}
        {rec.bridgeStatus === 'FAILED' && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
            <p>{rec.bridgeError ?? t('rcpt.failed', { name: rec.displayName })}</p>
            <div className="mt-3">
              <Button variant="secondary" onClick={retry}>
                {t('action.retry')}
              </Button>
            </div>
          </div>
        )}
        {rec.bridgeStatus === 'READY' && (
          <div className="mt-5">
            <Button
              onClick={() =>
                nav('/send', { state: { recipientId: rec.recipientId } })
              }
            >
              {t('home.send')}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

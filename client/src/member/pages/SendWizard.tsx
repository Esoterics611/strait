import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useT, fmtMoney } from '../../lib/i18n';
import { api, ApiError, payoutMethodLabelKey } from '../../lib/api';
import {
  Button,
  Card,
  MethodCard,
  MoneyText,
  Skeleton,
  AmountInput,
  SummaryRail,
  TextInput,
} from '../../components/member';
import { useAsync } from '../useAsync';
import type {
  PayInMethod,
  PayInOption,
  PayoutMethod,
  Quote,
  Recipient,
} from '../../lib/contract';

interface Prefill {
  recipientId?: string;
  amount?: string;
  payInMethod?: PayInMethod;
  payOutMethod?: PayoutMethod;
  gotoReview?: boolean;
}

const STEP_KEYS = [
  'wiz.step.recipient',
  'wiz.step.amount',
  'wiz.step.payin',
  'wiz.step.payout',
  'wiz.step.review',
] as const;

export function SendWizard(): JSX.Element {
  const { t, lang } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const prefill = (loc.state as Prefill | null) ?? {};

  const recipients = useAsync<Recipient[]>(() => api.listRecipients(), []);

  const [step, setStep] = useState(1);
  const [recipientId, setRecipientId] = useState<string | null>(
    prefill.recipientId ?? null,
  );
  const [amount, setAmount] = useState(prefill.amount ?? '');
  const [payIn, setPayIn] = useState<PayInMethod | null>(
    prefill.payInMethod ?? null,
  );
  const [payOut, setPayOut] = useState<PayoutMethod | null>(
    prefill.payOutMethod ?? null,
  );
  const [search, setSearch] = useState('');

  const recipient = useMemo(
    () => recipients.data?.find((r) => r.recipientId === recipientId) ?? null,
    [recipients.data, recipientId],
  );

  // default payout from the recipient's bank when not preset
  useEffect(() => {
    if (recipient && !payOut) setPayOut(recipient.payoutMethod);
  }, [recipient, payOut]);

  const payInOpts = useAsync<PayInOption[]>(
    () => (recipientId ? api.payInOptions(recipientId) : Promise.resolve([])),
    [recipientId],
  );
  useEffect(() => {
    if (!payIn && payInOpts.data) {
      const first = payInOpts.data.find((o) => o.available);
      if (first) setPayIn(first.method);
    }
  }, [payIn, payInOpts.data]);

  // jump straight to review for the P1 "send again" fast path
  useEffect(() => {
    if (prefill.gotoReview && recipient && amount && payIn && payOut) {
      setStep(5);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient]);

  // ---- live quoting (debounced 300ms, cancel in-flight) ----
  const [quote, setQuote] = useState<Quote | null>(null);
  const [qPending, setQPending] = useState(false);
  const [qError, setQError] = useState<string | null>(null);
  const [belowFloor, setBelowFloor] = useState(false);
  const tokenRef = useRef(0);

  const sendMinor = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? String(Math.round(n * 100)) : null;
  }, [amount]);

  useEffect(() => {
    if (!recipientId || !sendMinor || !payIn || !payOut) {
      setQuote(null);
      return;
    }
    const token = ++tokenRef.current;
    setQPending(true);
    setQError(null);
    setBelowFloor(false);
    const id = setTimeout(() => {
      api
        .createQuote({
          recipientId,
          send: { currency: 'ILS', minor: sendMinor },
          payInMethod: payIn,
          payOutMethod: payOut,
        })
        .then((q) => {
          if (token !== tokenRef.current) return;
          setQuote(q);
        })
        .catch((e) => {
          if (token !== tokenRef.current) return;
          setQuote(null);
          if (e instanceof ApiError && e.code === 'BELOW_FLOOR') setBelowFloor(true);
          else setQError(t('wiz.amount.quoteErr'));
        })
        .finally(() => {
          if (token === tokenRef.current) setQPending(false);
        });
    }, 300);
    return () => clearTimeout(id);
  }, [recipientId, sendMinor, payIn, payOut, t]);

  const canNext = (): boolean => {
    if (step === 1) return !!recipient && recipient.bridgeStatus !== 'FAILED';
    if (step === 2) return !!quote && !belowFloor;
    if (step === 3) return !!payIn;
    if (step === 4) return !!payOut;
    return true;
  };

  const filtered =
    recipients.data?.filter((r) =>
      r.displayName.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      {/* progress stepper (mirrors in RTL automatically) */}
      <ol className="flex items-center gap-2">
        {STEP_KEYS.map((k, i) => {
          const n = i + 1;
          return (
            <li key={k} className="flex flex-1 items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                  n < step
                    ? 'bg-emerald-500 text-white'
                    : n === step
                      ? 'bg-brand-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                }`}
              >
                {n < step ? '✓' : n}
              </span>
              {n < STEP_KEYS.length && (
                <span
                  className={`h-0.5 flex-1 ${
                    n < step ? 'bg-emerald-400' : 'bg-slate-200'
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-slate-500">{t('wiz.step', { n: step })}</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
        <div>
          {step === 1 && (
            <section>
              <h2 className="text-lg font-semibold text-slate-900">
                {t('wiz.recipient.pick')}
              </h2>
              <div className="mt-4 space-y-3">
                <TextInput
                  label={t('wiz.recipient.search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {recipients.loading &&
                  [0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
                {filtered.map((r) => (
                  <button
                    key={r.recipientId}
                    onClick={() => setRecipientId(r.recipientId)}
                    className={`w-full rounded-2xl border p-4 text-start ${
                      r.recipientId === recipientId
                        ? 'border-brand-500 bg-brand-50'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900">
                        {r.displayName}
                      </span>
                      <span className="text-xs text-slate-500">
                        {t('rcpt.maskedTo', {
                          last4: r.bankAccountLast4 ?? '••••',
                        })}
                      </span>
                    </div>
                    {r.bridgeStatus === 'REGISTERING' && (
                      <p className="mt-1 text-xs text-amber-700">
                        {t('wiz.recipient.settingUp')}
                      </p>
                    )}
                    {r.bridgeStatus === 'FAILED' && (
                      <Link
                        to={`/recipients/${r.recipientId}`}
                        className="mt-1 inline-block text-xs font-medium text-rose-700"
                      >
                        {t('wiz.recipient.fix')}
                      </Link>
                    )}
                  </button>
                ))}
                <Link
                  to="/recipients/new"
                  state={{ fromWizard: true }}
                  className="block rounded-2xl border border-dashed border-slate-300 px-4 py-3 text-center text-sm font-medium text-brand-700"
                >
                  {t('wiz.recipient.addNew')}
                </Link>
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <AmountInput
                label={t('wiz.amount.label')}
                value={amount}
                onChange={setAmount}
                autoFocus
              />
              {belowFloor && (
                <p className="mt-3 text-sm text-rose-600">
                  {t('wiz.amount.belowFloor', { amt: '₪4' })}
                </p>
              )}
              <p className="mt-3 text-xs text-slate-400">
                {t('wiz.review.rateLocks')}
              </p>
            </section>
          )}

          {step === 3 && (
            <section role="radiogroup" aria-label={t('wiz.payin.title')}>
              <h2 className="text-lg font-semibold text-slate-900">
                {t('wiz.payin.title')}
              </h2>
              <div className="mt-4 space-y-3">
                {payInOpts.loading &&
                  [0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                {payInOpts.data?.map((o) => (
                  <MethodCard
                    key={o.method}
                    title={t(`payin.${o.method}`)}
                    speed={o.speedText}
                    note={o.feeNote}
                    selected={payIn === o.method}
                    disabled={!o.available}
                    disabledReason={o.unavailableReason}
                    onSelect={() => setPayIn(o.method)}
                  />
                ))}
              </div>
            </section>
          )}

          {step === 4 && (
            <section role="radiogroup" aria-label={t('wiz.payout.title')}>
              <h2 className="text-lg font-semibold text-slate-900">
                {t('wiz.payout.title')}
              </h2>
              <div className="mt-4 space-y-3">
                {(['BANK_RTP', 'BANK_ACH'] as PayoutMethod[]).map((m) => {
                  const achOnly = recipient?.payoutMethod === 'BANK_ACH';
                  const disabled = m !== 'BANK_ACH' && achOnly;
                  return (
                    <MethodCard
                      key={m}
                      title={t(payoutMethodLabelKey(m))}
                      speed={
                        m === 'BANK_ACH'
                          ? t('wiz.payout.standard')
                          : t('wiz.payout.instant')
                      }
                      selected={payOut === m}
                      disabled={disabled}
                      disabledReason={disabled ? t('wiz.payout.achOnly') : null}
                      recommended={m === 'BANK_RTP'}
                      recommendedLabel={t('wiz.payout.recommended')}
                      onSelect={() => setPayOut(m)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {step === 5 && (
            <ReviewStep
              quote={quote}
              recipient={recipient}
              payIn={payIn}
              onConfirm={async () => {
                if (!quote) return;
                const tx = await api.createTransfer({ quoteId: quote.quoteId });
                nav(`/send/${tx.txId}/fund`, { replace: true });
              }}
              onReQuote={async () => {
                if (!recipientId || !sendMinor || !payIn || !payOut) return;
                const q = await api.createQuote({
                  recipientId,
                  send: { currency: 'ILS', minor: sendMinor },
                  payInMethod: payIn,
                  payOutMethod: payOut,
                });
                setQuote(q);
              }}
            />
          )}

          {step < 5 && (
            <div className="mt-8 flex items-center justify-between">
              <Button
                variant="ghost"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
              >
                {t('action.back')}
              </Button>
              <Button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canNext()}
              >
                {t('action.continue')}
              </Button>
            </div>
          )}
          {step === 5 && (
            <div className="mt-6">
              <Button variant="ghost" onClick={() => setStep(4)}>
                {t('action.back')}
              </Button>
            </div>
          )}
        </div>

        {/* persistent summary rail (right ≥md, sticky bottom < md) */}
        {step >= 2 && (
          <div className="md:sticky md:top-6 md:self-start">
            <SummaryRail
              quote={quote}
              pending={qPending}
              error={qError}
            />
            {lang === 'he' && <span className="sr-only">{t('rail.theyGet')}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewStep({
  quote,
  recipient,
  payIn,
  onConfirm,
  onReQuote,
}: {
  quote: Quote | null;
  recipient: Recipient | null;
  payIn: PayInMethod | null;
  onConfirm: () => Promise<void>;
  onReQuote: () => Promise<void>;
}): JSX.Element {
  const { t, lang } = useT();
  const [secs, setSecs] = useState(0);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!quote) return;
    const tick = (): void => {
      const left = Math.round(
        (new Date(quote.expiresAt).getTime() - Date.now()) / 1000,
      );
      setSecs(Math.max(0, left));
      setExpired(left <= 0);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [quote]);

  if (!quote || !recipient) return <Skeleton className="h-64 w-full" />;

  const notReady = recipient.bridgeStatus !== 'READY';

  return (
    <section>
      <h2 className="text-lg font-semibold text-slate-900">
        {t('wiz.review.title')}
      </h2>
      <Card className="mt-4 p-5">
        <dl className="space-y-2 text-sm">
          <Row k={t('wiz.review.to')}>
            {recipient.displayName} ·{' '}
            {t('rcpt.maskedTo', { last4: recipient.bankAccountLast4 ?? '••••' })}
          </Row>
          <Row k={t('rail.youSend')}>
            <MoneyText money={quote.send} bold />
          </Row>
          <Row k={t('rail.fee')}>
            <MoneyText money={quote.fee} />
          </Row>
          <Row k={t('rail.theyGet')}>
            <MoneyText money={quote.receive} bold className="text-emerald-700" />
          </Row>
          <Row k={t('wiz.review.via')}>
            {payIn ? t(`payin.${payIn}`) : '—'}
          </Row>
          <Row k={t('wiz.review.delivery')}>
            {t(payoutMethodLabelKey(quote.payOutMethod))}
          </Row>
        </dl>
        <p className="mt-3 text-xs text-slate-500">{quote.etaText}</p>
      </Card>

      {notReady && (
        <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t('wiz.review.recipientNotReady', { name: recipient.displayName })}
        </p>
      )}

      <p
        aria-live="polite"
        className={`mt-4 text-xs ${
          secs <= 10 ? 'font-medium text-amber-700' : 'text-slate-500'
        }`}
      >
        {expired
          ? t('wiz.review.expired')
          : t('wiz.review.expiresIn', { sec: `0:${String(secs).padStart(2, '0')}` })}
      </p>

      <div className="mt-4">
        {expired ? (
          <Button
            full
            variant="secondary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onReQuote();
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('wiz.review.reaccept')}
          </Button>
        ) : (
          <Button
            full
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? t('wiz.review.confirming')
              : t('wiz.review.confirm', {
                  total: fmtMoney(quote.send, lang),
                })}
          </Button>
        )}
      </div>
    </section>
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

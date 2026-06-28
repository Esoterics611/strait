import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useT, fmtMoney, fmtDate, fmtDateTime, fmtRelative } from '../../lib/i18n';
import { api, API_MODE, type MockScenario } from '../../lib/api';
import {
  STAGE_LABELS,
  isTerminalStage,
  stageFor,
} from '../../lib/state-labels';
import {
  Button,
  Card,
  ConnectionPill,
  ErrorState,
  Skeleton,
  useToast,
} from '../../components/member';
import { Stepper } from '../../components/member';
import { useTxStatus } from '../../hooks/useTxStatus';
import { useAsync } from '../useAsync';
import type { StageKey, Transfer } from '../../lib/contract';

export function TrackingPage(): JSX.Element {
  const { t, lang } = useT();
  const { txId } = useParams<{ txId: string }>();
  const nav = useNavigate();
  const toast = useToast();

  const transfer = useAsync<Transfer>(() => api.getTransfer(txId ?? ''), [txId]);
  const tx = transfer.data;

  const initial = tx
    ? {
        state: tx.state,
        stage: stageFor(tx.state),
        etaText: tx.quote.etaText,
        dispatchTxHash: null,
        settledAt: null,
        payoutMethodUsed: null,
        failureReason: null,
        refundExpectedBy: null,
      }
    : null;

  const { snapshot, connection } = useTxStatus(txId, initial);
  const snap = snapshot ?? initial;
  const stage: StageKey = snap?.stage ?? 'FUNDING';

  // toast + announce on stage advance
  const prevStage = useRef<StageKey | null>(null);
  useEffect(() => {
    if (prevStage.current && prevStage.current !== stage) {
      toast.show(
        t('track.now', {
          stage: STAGE_LABELS[stage][lang === 'he' ? 'he' : 'en'],
        }),
        isTerminalStage(stage) && stage !== 'DONE' ? 'danger' : 'success',
      );
    }
    prevStage.current = stage;
  }, [stage, lang, t, toast]);

  if (transfer.loading)
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <Skeleton className="h-72 w-full" />
      </div>
    );
  if (transfer.error || !tx || !snap)
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <ErrorState onRetry={transfer.reload} />
      </div>
    );

  const recipientName = tx.recipient.displayName;
  const recipientSetup =
    stage === 'READYING' && tx.recipient.dispatchStatus !== 'READY';
  const terminal = isTerminalStage(stage);

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">{t('track.title')}</p>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">
            {fmtMoney(tx.quote.send, lang)} → {fmtMoney(tx.quote.receive, lang)}
          </h1>
          <p className="text-sm text-slate-500">{recipientName}</p>
        </div>
        <ConnectionPill connection={connection} />
      </div>

      {/* live region: words, not enums */}
      <p
        aria-live={terminal && stage !== 'DONE' ? 'assertive' : 'polite'}
        className="sr-only"
      >
        {t('track.now', {
          stage: STAGE_LABELS[stage][lang === 'he' ? 'he' : 'en'],
        })}
      </p>

      <Card className="mt-6 p-6">
        <Stepper
          current={stage}
          stalled={terminal && stage !== 'DONE'}
          labelOverride={{
            DELIVERING: STAGE_LABELS.DELIVERING[lang === 'he' ? 'he' : 'en'].replace(
              lang === 'he' ? 'הנמען' : 'your recipient',
              recipientName,
            ),
            READYING: recipientSetup
              ? t('track.recipientSetup', { name: recipientName })
              : undefined,
          }}
        />
      </Card>

      {snap.etaText && !terminal && (
        <p className="mt-4 text-sm text-slate-600">{snap.etaText}</p>
      )}

      {/* contextual zone */}
      <div className="mt-6 space-y-4">
        {stage === 'DONE' && (
          <Card className="border-emerald-200 bg-emerald-50 p-6 text-center">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-500 text-2xl text-white motion-safe:animate-[fade-in_.3s_ease-out]">
              ✓
            </div>
            <p className="text-base font-semibold text-emerald-900">
              {t('track.delivered', {
                amt: fmtMoney(tx.quote.receive, lang),
                name: recipientName,
              })}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Link to={`/activity/${tx.txId}`}>
                <Button variant="secondary">{t('track.saveReceipt')}</Button>
              </Link>
              <Button
                onClick={() =>
                  nav('/send', {
                    state: {
                      recipientId: tx.recipient.recipientId,
                      amount: String(Number(tx.quote.send.minor) / 100),
                      payInMethod: tx.quote.payInMethod,
                      payOutMethod: tx.quote.payOutMethod,
                      gotoReview: true,
                    },
                  })
                }
              >
                {t('track.sendAgain')}
              </Button>
            </div>
          </Card>
        )}

        {stage === 'FAILED' && (
          <Card className="border-rose-200 bg-rose-50 p-6">
            <p className="font-semibold text-rose-900">
              {t('track.fail.preDispatch', {
                total: fmtMoney(tx.quote.send, lang),
              })}
            </p>
            {snap.failureReason && (
              <p className="mt-1 text-sm text-rose-800">{snap.failureReason}</p>
            )}
            <div className="mt-4 flex gap-2">
              <Button
                onClick={() =>
                  nav('/send', {
                    state: { recipientId: tx.recipient.recipientId },
                  })
                }
              >
                {t('action.retry')}
              </Button>
              <Button variant="secondary">{t('action.getHelp')}</Button>
            </div>
          </Card>
        )}

        {stage === 'FAILED_DISPATCH' && (
          <Card className="border-rose-200 bg-rose-50 p-6">
            <p className="font-semibold text-rose-900">
              {t('track.fail.bridge', {
                name: recipientName,
                total: fmtMoney(tx.quote.send, lang),
                date: snap.refundExpectedBy
                  ? fmtDate(snap.refundExpectedBy, lang)
                  : '—',
              })}
            </p>
            {snap.dispatchTxHash && (
              <p className="mt-2 text-xs text-rose-700">
                {t('common.reference', { id: snap.dispatchTxHash })}
              </p>
            )}
          </Card>
        )}

        {stage === 'REVERSING' && (
          <Card className="border-amber-200 bg-amber-50 p-6">
            <p className="font-medium text-amber-900">
              {t('track.reversing', {
                total: fmtMoney(tx.quote.send, lang),
                date: snap.refundExpectedBy
                  ? fmtDate(snap.refundExpectedBy, lang)
                  : '—',
              })}
            </p>
          </Card>
        )}

        {stage === 'REFUNDED' && (
          <Card className="border-slate-200 bg-slate-50 p-6">
            <p className="font-medium text-slate-800">
              {t('track.refunded', { total: fmtMoney(tx.quote.send, lang) })}
            </p>
            {snap.dispatchTxHash && (
              <p className="mt-2 text-xs text-slate-500">
                {t('common.reference', { id: snap.dispatchTxHash })}
              </p>
            )}
          </Card>
        )}

        {!terminal && connection === 'closed' && (
          <p className="text-sm text-slate-500">
            {t('track.lastUpdate', { rel: fmtRelative(tx.createdAt, lang) })}
          </p>
        )}
      </div>

      {(snap.dispatchTxHash || snap.settledAt) && (
        <Card className="mt-6 p-5 text-sm">
          <h2 className="font-semibold text-slate-900">{t('track.settlement')}</h2>
          <dl className="mt-3 space-y-1.5">
            {snap.dispatchTxHash && (
              <Detail k={t('track.dispatchTxHash')} v={snap.dispatchTxHash} mono />
            )}
            {snap.payoutMethodUsed && <Detail k={t('track.payoutMethod')} v={snap.payoutMethodUsed} />}
            {snap.settledAt && (
              <Detail k={t('track.settledAt')} v={fmtDateTime(snap.settledAt, lang)} />
            )}
          </dl>
        </Card>
      )}

      {API_MODE === 'mock' && <MockScenarioControl />}
    </div>
  );
}

function Detail({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-500">{k}</dt>
      <dd className={mono ? 'font-mono text-slate-900' : 'text-slate-900'}>
        {v}
      </dd>
    </div>
  );
}

// Dev-only timeline picker so every §9 row is demoable against the mock.
function MockScenarioControl(): JSX.Element {
  const [s, setS] = useState<MockScenario>(api.mock?.scenario ?? 'happy');
  const opts: MockScenario[] = [
    'happy',
    'failed',
    'failed_dispatch',
    'reversed',
  ];
  return (
    <div className="mt-10 rounded-xl border border-dashed border-slate-300 p-3 text-xs">
      <p className="mb-2 font-medium text-slate-500">Mock timeline</p>
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o) => (
          <button
            key={o}
            onClick={() => {
              api.mock?.setScenario(o);
              setS(o);
            }}
            className={`rounded-md px-2 py-1 ${
              s === o
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {o}
          </button>
        ))}
      </div>
      <p className="mt-2 text-slate-400">
        Pick, then reopen this transfer to replay.
      </p>
    </div>
  );
}

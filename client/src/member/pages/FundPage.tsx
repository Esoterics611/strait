import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';
import { Button, Card, ErrorState, Skeleton } from '../../components/member';
import { VirtualAccountDisplay } from '../../components/VirtualAccountDisplay';
import { useAsync } from '../useAsync';
import type { Transfer } from '../../lib/contract';

export function FundPage(): JSX.Element {
  const { t } = useT();
  const { txId } = useParams<{ txId: string }>();
  const nav = useNavigate();
  const { data, loading, error, reload } = useAsync<Transfer>(
    () => api.getTransfer(txId ?? ''),
    [txId],
  );

  if (loading)
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (error || !data)
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <ErrorState onRetry={reload} />
      </div>
    );

  const pi = data.payIn;

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <h1 className="text-xl font-semibold text-slate-900">{t('fund.title')}</h1>

      <div className="mt-6">
        {pi.method === 'MESH' && pi.mesh && (
          <Card className="p-5">
            <h2 className="text-base font-semibold text-slate-900">
              {t('fund.mesh.title')}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{t('fund.mesh.body')}</p>
            <a
              href={pi.mesh.connectUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex min-h-[44px] items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              {t('fund.mesh.connect')}
            </a>
          </Card>
        )}

        {pi.method === 'ONRAMP' && pi.onramp && (
          <div className="space-y-4">
            <VirtualAccountDisplay
              fields={[
                { label: t('fund.onramp.bank'), value: pi.onramp.bankName },
                {
                  label: t('fund.onramp.account'),
                  value: pi.onramp.accountNumber,
                },
                {
                  label: t('fund.onramp.reference'),
                  value: pi.onramp.reference,
                },
              ]}
            />
            <NextSteps />
          </div>
        )}

        {pi.method === 'IL_BANK' && pi.ilBank && (
          <div className="space-y-4">
            <VirtualAccountDisplay
              fields={[
                {
                  label: t('fund.ilbank.beneficiary'),
                  value: pi.ilBank.beneficiary,
                },
                { label: t('fund.ilbank.iban'), value: pi.ilBank.iban },
                {
                  label: t('fund.ilbank.reference'),
                  value: pi.ilBank.reference,
                },
              ]}
            />
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t('fund.ilbank.window')}
            </p>
          </div>
        )}
      </div>

      <div className="mt-8">
        <Button full onClick={() => nav(`/t/${data.txId}`)}>
          {t('fund.track')}
        </Button>
      </div>
    </div>
  );
}

function NextSteps(): JSX.Element {
  const { t } = useT();
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-900">
        {t('fund.onramp.next')}
      </h2>
      <ol className="mt-3 list-decimal space-y-1 ps-5 text-sm text-slate-600">
        <li>{t('fund.onramp.step1')}</li>
        <li>{t('fund.onramp.step2')}</li>
        <li>{t('fund.onramp.step3')}</li>
      </ol>
    </Card>
  );
}

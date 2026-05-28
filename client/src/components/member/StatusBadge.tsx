import {
  STAGE_LABELS,
  stageFor,
  type StageTone,
  type TxState,
} from '../../lib/state-labels';
import { useT } from '../../lib/i18n';

const TONE: Record<StageTone, string> = {
  pending: 'bg-amber-100 text-amber-800',
  progress: 'bg-sky-100 text-sky-800',
  success: 'bg-emerald-100 text-emerald-800',
  warn: 'bg-amber-100 text-amber-800',
  danger: 'bg-rose-100 text-rose-800',
  neutral: 'bg-slate-100 text-slate-700',
};

export function StatusBadge({ state }: { state: TxState }): JSX.Element {
  const { lang } = useT();
  const stage = stageFor(state);
  const label = STAGE_LABELS[stage];
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONE[label.tone]}`}
    >
      {lang === 'he' ? label.he : label.en}
    </span>
  );
}

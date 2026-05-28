import {
  STAGE_LABELS,
  STAGE_ORDER,
  stageStepIndex,
  type StageKey,
} from '../../lib/state-labels';
import { useT } from '../../lib/i18n';

// Vertical stage stepper. RTL handled by logical utilities + dir-aware order
// (the rail mirrors automatically). `current` is the §9 stage; terminal
// failure/reversal stages render the whole rail complete-or-stalled and the
// page swaps the contextual zone (see tracking screen).
export function Stepper({
  current,
  labelOverride,
  stalled = false,
}: {
  current: StageKey;
  labelOverride?: Partial<Record<StageKey, string>>;
  stalled?: boolean;
}): JSX.Element {
  const { lang } = useT();
  const activeIdx = stageStepIndex(current);
  // Terminal-but-not-DONE stages keep the rail at the last forward node.
  const effIdx = activeIdx >= 0 ? activeIdx : STAGE_ORDER.length - 2;

  return (
    <ol className="space-y-0">
      {STAGE_ORDER.map((stage, i) => {
        const done = i < effIdx || (current === 'DONE' && i <= effIdx);
        const isActive = i === effIdx && current !== 'DONE';
        const label =
          labelOverride?.[stage] ?? STAGE_LABELS[stage][lang === 'he' ? 'he' : 'en'];
        const last = i === STAGE_ORDER.length - 1;
        return (
          <li
            key={stage}
            aria-current={isActive ? 'step' : undefined}
            className="relative flex gap-3 ps-1"
          >
            <div className="flex flex-col items-center">
              <span
                aria-hidden
                className={
                  `flex h-7 w-7 shrink-0 items-center justify-center rounded-full ` +
                  `border-2 text-xs font-bold transition ` +
                  (done
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : isActive
                      ? `border-brand-500 bg-brand-50 text-brand-700 ${
                          stalled ? '' : 'motion-safe:animate-pulse'
                        }`
                      : 'border-slate-300 bg-white text-slate-400')
                }
              >
                {done ? '✓' : i + 1}
              </span>
              {!last && (
                <span
                  aria-hidden
                  className={`my-1 w-0.5 grow ${
                    done ? 'bg-emerald-400' : 'bg-slate-200'
                  }`}
                  style={{ minHeight: 28 }}
                />
              )}
            </div>
            <div className={`pb-6 ${last ? 'pb-0' : ''}`}>
              <p
                className={
                  'text-sm font-medium ' +
                  (done
                    ? 'text-emerald-700'
                    : isActive
                      ? 'text-slate-900'
                      : 'text-slate-400')
                }
              >
                {label}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// Selectable comparison card for pay-in / pay-out methods. Radio-group
// semantics; disabled cards expose their reason in the accessible name.
export function MethodCard({
  title,
  speed,
  note,
  selected,
  disabled = false,
  disabledReason,
  recommended = false,
  recommendedLabel,
  onSelect,
}: {
  title: string;
  speed: string;
  note?: string | null;
  selected: boolean;
  disabled?: boolean;
  disabledReason?: string | null;
  recommended?: boolean;
  recommendedLabel?: string;
  onSelect: () => void;
}): JSX.Element {
  const accessible = disabled
    ? `${title}, ${speed}${disabledReason ? `, ${disabledReason}` : ''}`
    : `${title}, ${speed}`;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled || undefined}
      aria-label={accessible}
      onClick={() => !disabled && onSelect()}
      className={
        `w-full rounded-2xl border p-4 text-start transition ` +
        `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ` +
        (disabled
          ? 'cursor-not-allowed border-slate-200 bg-slate-50 opacity-70'
          : selected
            ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
            : 'border-slate-200 bg-white hover:border-slate-300')
      }
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        {recommended && !disabled && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
            {recommendedLabel}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-600">{speed}</p>
      {note && !disabled && (
        <p className="mt-0.5 text-xs text-slate-500">{note}</p>
      )}
      {disabled && disabledReason && (
        <p className="mt-1 text-xs text-slate-500">{disabledReason}</p>
      )}
    </button>
  );
}

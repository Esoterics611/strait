import { useId } from 'react';

// Big ILS amount field. Digits stay LTR even in RTL layout. Value is the
// major-unit string the sender typed (e.g. "500" or "500.50"); empty allowed.
export function AmountInput({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoFocus?: boolean;
}): JSX.Element {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-600">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-3xl font-semibold text-slate-400" aria-hidden>
          ₪
        </span>
        <input
          id={id}
          dir="ltr"
          inputMode="decimal"
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
          placeholder="0.00"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d.]/g, '');
            const parts = v.split('.');
            const norm =
              parts.length > 1
                ? `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`
                : v;
            onChange(norm);
          }}
          className="w-full bg-transparent text-start text-4xl font-bold tabular-nums text-slate-900 placeholder:text-slate-300 focus:outline-none"
        />
      </div>
      <div className="mt-1 h-px bg-slate-200" />
    </div>
  );
}

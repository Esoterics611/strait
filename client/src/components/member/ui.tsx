// Shared member-app primitives. Tailwind only; reduced-motion respected.
// Do NOT import from client/src/admin/*.
import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import type { Money } from '../../lib/contract';
import { fmtMoney, useT } from '../../lib/i18n';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:bg-brand-600/50',
  secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200 disabled:opacity-50',
  ghost: 'bg-transparent text-brand-700 hover:bg-brand-50 disabled:opacity-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  full?: boolean;
}

export function Button({
  variant = 'primary',
  loading = false,
  full = false,
  className = '',
  disabled,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={
        `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-5 ` +
        `text-sm font-semibold transition motion-safe:active:scale-[.98] ` +
        `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ` +
        `focus-visible:ring-offset-2 disabled:cursor-not-allowed ` +
        `${full ? 'w-full ' : ''}${VARIANT[variant]} ${className}`
      }
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span
      aria-hidden
      className={
        `inline-block h-4 w-4 rounded-full border-2 border-current ` +
        `border-t-transparent motion-safe:animate-spin ${className}`
      }
    />
  );
}

export function Card({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white ${className}`}>
      {children}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
  numeric?: boolean; // keep digits LTR even in RTL
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ label, error, hint, numeric, className = '', ...rest }, ref) {
    const id = useId();
    const errId = `${id}-err`;
    const hintId = `${id}-hint`;
    return (
      <div className="w-full">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        <input
          {...rest}
          id={id}
          ref={ref}
          dir={numeric ? 'ltr' : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : hint ? hintId : undefined}
          className={
            `mt-1 block w-full rounded-xl border bg-white px-3 py-2.5 text-sm ` +
            `text-slate-900 placeholder:text-slate-400 focus:outline-none ` +
            `focus:ring-2 focus:ring-brand-500 ${
              error ? 'border-rose-400' : 'border-slate-300'
            } ${numeric ? 'text-start tabular-nums' : ''} ${className}`
          }
        />
        {hint && !error && (
          <p id={hintId} className="mt-1 text-xs text-slate-500">
            {hint}
          </p>
        )}
        {error && (
          <p id={errId} className="mt-1 text-xs text-rose-600">
            {error}
          </p>
        )}
      </div>
    );
  },
);

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-xl bg-slate-100 p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={
              `min-h-[40px] rounded-lg px-4 text-sm font-medium transition ` +
              (active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function MoneyText({
  money,
  className = '',
  bold = false,
}: {
  money: Money;
  className?: string;
  bold?: boolean;
}): JSX.Element {
  const { lang } = useT();
  return (
    <span
      className={`tabular-nums ${bold ? 'font-semibold' : ''} ${className}`}
    >
      {fmtMoney(money, lang)}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }): JSX.Element {
  return (
    <div
      aria-hidden
      className={`rounded-lg bg-slate-200/70 motion-safe:animate-pulse ${className}`}
    />
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}): JSX.Element {
  const { t } = useT();
  return (
    <div
      role="alert"
      className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-8 text-center"
    >
      <p className="text-sm font-medium text-rose-800">
        {message ?? t('common.somethingWrong')}
      </p>
      {onRetry && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={onRetry}>
            {t('action.retry')}
          </Button>
        </div>
      )}
    </div>
  );
}

import { ReactNode, useEffect } from 'react';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white border border-slate-200 rounded-lg shadow-xl w-full ${maxWidth}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2 rounded-b-lg">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className="block mb-3">
      <span className="block text-xs font-medium text-slate-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  );
}

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
): JSX.Element {
  return (
    <input
      {...props}
      className={`w-full border border-slate-300 rounded px-3 py-2 text-sm ${props.className ?? ''}`}
    />
  );
}

export function TextArea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
): JSX.Element {
  return (
    <textarea
      {...props}
      className={`w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono ${props.className ?? ''}`}
    />
  );
}

export function Select(
  props: React.SelectHTMLAttributes<HTMLSelectElement>,
): JSX.Element {
  return (
    <select
      {...props}
      className={`w-full border border-slate-300 rounded px-3 py-2 text-sm ${props.className ?? ''}`}
    />
  );
}

export function PrimaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  return (
    <button
      {...props}
      className={`bg-slate-900 text-white text-sm rounded px-3 py-1.5 hover:bg-slate-800 disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

export function SecondaryButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  return (
    <button
      {...props}
      className={`border border-slate-300 text-sm rounded px-3 py-1.5 hover:bg-slate-50 disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

export function DangerButton(
  props: React.ButtonHTMLAttributes<HTMLButtonElement>,
): JSX.Element {
  return (
    <button
      {...props}
      className={`border border-rose-300 text-rose-700 text-sm rounded px-3 py-1.5 hover:bg-rose-50 disabled:opacity-50 ${props.className ?? ''}`}
    />
  );
}

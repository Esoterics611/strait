import { useState } from 'react';

interface Field {
  label: string;
  value: string;
}

interface Props {
  fields: Field[];
}

export function VirtualAccountDisplay({ fields }: Props): JSX.Element {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      {fields.map((f, i) => (
        <Row key={f.label} field={f} divided={i !== 0} />
      ))}
    </div>
  );
}

function Row({ field, divided }: { field: Field; divided: boolean }): JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(field.value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = field.value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className={(divided ? 'border-t border-slate-100 ' : '') + 'flex items-center justify-between p-4'}>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-wider text-slate-500">{field.label}</div>
        <div className="font-mono text-sm text-slate-900 truncate mt-1">{field.value}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        className={
          'shrink-0 ml-4 rounded-md px-3 py-1.5 text-xs font-medium transition ' +
          (copied
            ? 'bg-emerald-50 text-emerald-700'
            : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
        }
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

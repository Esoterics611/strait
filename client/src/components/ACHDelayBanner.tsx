interface Props {
  estimatedDate: string;
}

export function ACHDelayBanner({ estimatedDate }: Props): JSX.Element {
  const display = formatDate(estimatedDate);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-200 text-amber-800 font-semibold">
          ⏱
        </span>
        <div>
          <div className="font-medium text-amber-900">Routed via ACH instead of RTP</div>
          <div className="text-sm text-amber-800 mt-1">
            Your recipient's bank did not accept the instant rail. We're routing this
            payment via ACH; expected arrival by <strong>{display}</strong>.
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

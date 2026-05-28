/**
 * Lightweight inline-SVG charts. No external dependency — keeps the bundle lean
 * and the WSL install path predictable. Each component accepts pre-computed
 * data and an optional `height`; widths flex 100%.
 */
import { useMemo } from 'react';

const CHART_HEIGHT = 240;
const CHART_PAD_TOP = 12;
const CHART_PAD_BOTTOM = 22;
const CHART_PAD_LEFT = 40;
const CHART_PAD_RIGHT = 8;

export interface SeriesPoint {
  label: string;
  values: Record<string, number>;
}

const PALETTE = ['#0ea5e9', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#64748b'];

/**
 * Grouped (stacked) bar chart. Each `data` row is a label + values per series.
 * Series order is the keys of the first row's `values` object.
 */
export function GroupedBarChart({
  data,
  height = CHART_HEIGHT,
  yFormat = (n) => String(n),
}: {
  data: SeriesPoint[];
  height?: number;
  yFormat?: (n: number) => string;
}): JSX.Element {
  const seriesKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of data) Object.keys(row.values).forEach((k) => keys.add(k));
    return Array.from(keys);
  }, [data]);

  const innerH = height - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const totals = data.map((d) => seriesKeys.reduce((acc, k) => acc + (d.values[k] ?? 0), 0));
  const maxVal = Math.max(1, ...totals);
  const yTicks = 4;
  const tickValues = Array.from({ length: yTicks + 1 }, (_, i) => (maxVal / yTicks) * i);

  if (data.length === 0) {
    return <div className="text-sm text-slate-400 px-4 py-8 text-center">No data in range.</div>;
  }

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${800} ${height}`} className="w-full" preserveAspectRatio="none">
        {/* y-axis grid + labels */}
        {tickValues.map((t, i) => {
          const y = CHART_PAD_TOP + innerH - (t / maxVal) * innerH;
          return (
            <g key={i}>
              <line x1={CHART_PAD_LEFT} y1={y} x2={800 - CHART_PAD_RIGHT} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={CHART_PAD_LEFT - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
                {yFormat(Math.round(t))}
              </text>
            </g>
          );
        })}
        {/* bars */}
        {data.map((d, i) => {
          const barAreaW = (800 - CHART_PAD_LEFT - CHART_PAD_RIGHT) / data.length;
          const barW = Math.max(2, barAreaW * 0.7);
          const x = CHART_PAD_LEFT + i * barAreaW + (barAreaW - barW) / 2;
          let acc = 0;
          return (
            <g key={i}>
              {seriesKeys.map((k, si) => {
                const v = d.values[k] ?? 0;
                const segH = (v / maxVal) * innerH;
                const y = CHART_PAD_TOP + innerH - acc - segH;
                acc += segH;
                return v > 0 ? (
                  <rect key={k} x={x} y={y} width={barW} height={segH} fill={PALETTE[si % PALETTE.length]}>
                    <title>{`${k}: ${yFormat(v)}`}</title>
                  </rect>
                ) : null;
              })}
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize="9"
                fill="#94a3b8"
                transform={data.length > 12 ? `rotate(-30 ${x + barW / 2} ${height - 6})` : undefined}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend keys={seriesKeys} />
    </div>
  );
}

/** Line chart with a translucent min/max band. */
export function LineChart({
  data,
  height = CHART_HEIGHT,
  yFormat = (n) => n.toFixed(4),
}: {
  data: Array<{ label: string; min: number; median: number; max: number }>;
  height?: number;
  yFormat?: (n: number) => string;
}): JSX.Element {
  if (data.length === 0) {
    return <div className="text-sm text-slate-400 px-4 py-8 text-center">No data in range.</div>;
  }

  const innerW = 800 - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const innerH = height - CHART_PAD_TOP - CHART_PAD_BOTTOM;
  const maxV = Math.max(...data.map((d) => d.max));
  const minV = Math.min(...data.map((d) => d.min));
  const range = Math.max(maxV - minV, 0.000001);

  const xFor = (i: number) => CHART_PAD_LEFT + (i / Math.max(1, data.length - 1)) * innerW;
  const yFor = (v: number) =>
    CHART_PAD_TOP + innerH - ((v - minV) / range) * innerH;

  const bandTop = data.map((d, i) => `${xFor(i)},${yFor(d.max)}`).join(' ');
  const bandBottom = data.map((d, i) => `${xFor(i)},${yFor(d.min)}`).reverse().join(' ');
  const median = data.map((d, i) => `${xFor(i)},${yFor(d.median)}`).join(' ');

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => minV + (range / yTicks) * i);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${800} ${height}`} className="w-full" preserveAspectRatio="none">
        {tickVals.map((t, i) => {
          const y = yFor(t);
          return (
            <g key={i}>
              <line x1={CHART_PAD_LEFT} y1={y} x2={800 - CHART_PAD_RIGHT} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={CHART_PAD_LEFT - 4} y={y + 3} textAnchor="end" fontSize="9" fill="#94a3b8">
                {yFormat(t)}
              </text>
            </g>
          );
        })}
        <polygon points={`${bandTop} ${bandBottom}`} fill="#bae6fd" fillOpacity="0.5" />
        <polyline points={median} fill="none" stroke="#0ea5e9" strokeWidth={2} />
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={xFor(i)} cy={yFor(d.median)} r={3} fill="#0ea5e9">
              <title>{`${d.label}: median ${yFormat(d.median)} (min ${yFormat(d.min)} / max ${yFormat(d.max)})`}</title>
            </circle>
            {(i === 0 || i === data.length - 1 || i % Math.ceil(data.length / 8) === 0) && (
              <text x={xFor(i)} y={height - 6} textAnchor="middle" fontSize="9" fill="#94a3b8">
                {d.label}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="text-[10px] text-slate-500 px-4">
        <span className="inline-block w-3 h-2 bg-sky-200 mr-1 align-middle"></span> min/max band
        <span className="inline-block w-3 border-t-2 border-sky-500 ml-3 mr-1 align-middle"></span> median
      </div>
    </div>
  );
}

function Legend({ keys }: { keys: string[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-3 px-4 mt-2">
      {keys.map((k, i) => (
        <div key={k} className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ background: PALETTE[i % PALETTE.length] }}
          />
          {k}
        </div>
      ))}
    </div>
  );
}

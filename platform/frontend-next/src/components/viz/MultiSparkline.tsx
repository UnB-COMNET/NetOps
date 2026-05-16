import { cn } from "@/lib/cn";

type Marker = { index: number; label?: string };

type Series = {
  id: string;
  values: number[];
  className?: string;
  strokeDasharray?: string;
  opacity?: number;
};

function pointsToPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}

export function MultiSparkline({
  series,
  className,
  markers,
  outliersById,
}: {
  series: Series[];
  className?: string;
  markers?: Marker[];
  outliersById?: Record<string, number[]>;
}) {
  const w = 240;
  const h = 70;
  const pad = 4;

  const allValues = series.flatMap((s) => s.values);
  const min = allValues.length ? Math.min(...allValues) : 0;
  const max = allValues.length ? Math.max(...allValues) : 1;
  const span = Math.max(1e-9, max - min);

  const maxLen = Math.max(1, ...series.map((s) => s.values.length));

  const xForIndex = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, maxLen - 1);
  const yForValue = (v: number) => {
    const t = (v - min) / span;
    return pad + (1 - t) * (h - pad * 2);
  };

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-[70px] w-full", className)} role="img" aria-label="multi series chart">
      {/* markers */}
      {markers?.map((m, idx) => {
        const x = xForIndex(Math.max(0, Math.min(maxLen - 1, m.index)));
        return (
          <g key={`${m.index}-${idx}`}>
            <line x1={x} y1={pad} x2={x} y2={h - pad} stroke="currentColor" opacity={0.18} strokeWidth={1} />
          </g>
        );
      })}

      {/* series */}
      {series.map((s) => {
        const pts = s.values.map((v, i) => ({ x: xForIndex(i), y: yForValue(v) }));
        const d = pointsToPath(pts);
        const outIdx = outliersById?.[s.id] ?? [];
        return (
          <g key={s.id} className={s.className}>
            <path
              d={d}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              opacity={s.opacity ?? 0.9}
              strokeDasharray={s.strokeDasharray}
            />
            {outIdx.map((i) => {
              const v = s.values[i];
              if (typeof v !== "number") return null;
              return (
                <circle
                  key={`${s.id}-o-${i}`}
                  cx={xForIndex(i)}
                  cy={yForValue(v)}
                  r={2.3}
                  fill="currentColor"
                  opacity={0.95}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

import { cn } from "@/lib/cn";

export function MiniScatter({
  x,
  y,
  className,
}: {
  x: number[];
  y: number[];
  className?: string;
}) {
  const w = 240;
  const h = 160;
  const pad = 10;
  const n = Math.min(x.length, y.length);

  const xMin = n ? Math.min(...x.slice(0, n)) : 0;
  const xMax = n ? Math.max(...x.slice(0, n)) : 1;
  const yMin = n ? Math.min(...y.slice(0, n)) : 0;
  const yMax = n ? Math.max(...y.slice(0, n)) : 1;

  const xSpan = Math.max(1e-9, xMax - xMin);
  const ySpan = Math.max(1e-9, yMax - yMin);

  const px = (v: number) => pad + ((v - xMin) / xSpan) * (w - pad * 2);
  const py = (v: number) => pad + (1 - (v - yMin) / ySpan) * (h - pad * 2);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-[160px] w-full", className)} role="img" aria-label="scatter plot">
      <rect x={0} y={0} width={w} height={h} fill="none" />
      {/* axes */}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="currentColor" opacity={0.2} />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="currentColor" opacity={0.2} />
      {Array.from({ length: n }).slice(0, 220).map((_, i) => {
        const xv = x[i] ?? 0;
        const yv = y[i] ?? 0;
        return <circle key={i} cx={px(xv)} cy={py(yv)} r={2.2} fill="currentColor" opacity={0.75} />;
      })}
    </svg>
  );
}

import { cn } from "@/lib/cn";

function pointsToPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  const [first, ...rest] = points;
  return [`M ${first.x} ${first.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}

export function Sparkline({
  values,
  className,
}: {
  values: number[];
  className?: string;
}) {
  const w = 120;
  const h = 34;
  const padding = 2;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);

  const pts = values.map((v, i) => {
    const x = padding + (i * (w - padding * 2)) / Math.max(1, values.length - 1);
    const t = (v - min) / span;
    const y = padding + (1 - t) * (h - padding * 2);
    return { x, y };
  });

  const path = pointsToPath(pts);

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-9 w-[120px]", className)}
      role="img"
      aria-label="sparkline"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.9" />
    </svg>
  );
}

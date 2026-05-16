import { cn } from "@/lib/cn";

function points(values: number[], w: number, h: number, pad: number) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-9, max - min);

  return values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / Math.max(1, values.length - 1);
    const t = (v - min) / span;
    const y = pad + (1 - t) * (h - pad * 2);
    return { x, y };
  });
}

function linePath(pts: Array<{ x: number; y: number }>) {
  if (pts.length === 0) return "";
  const [f, ...rest] = pts;
  return [`M ${f.x} ${f.y}`, ...rest.map((p) => `L ${p.x} ${p.y}`)].join(" ");
}

function areaPath(pts: Array<{ x: number; y: number }>, _w: number, h: number, pad: number) {
  if (pts.length === 0) return "";
  const d = linePath(pts);
  const last = pts[pts.length - 1];
  const first = pts[0];
  const baseY = h - pad;
  return `${d} L ${last.x} ${baseY} L ${first.x} ${baseY} Z`;
}

export function AreaMini({ values, className }: { values: number[]; className?: string }) {
  const w = 160;
  const h = 46;
  const pad = 3;
  const pts = points(values, w, h, pad);
  const dLine = linePath(pts);
  const dArea = areaPath(pts, w, h, pad);
  const gid = `g${Math.random().toString(16).slice(2)}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cn("h-[46px] w-[160px]", className)}
      role="img"
      aria-label="area chart"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={dArea} fill={`url(#${gid})`} stroke="none" />
      <path d={dLine} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.95" />
    </svg>
  );
}

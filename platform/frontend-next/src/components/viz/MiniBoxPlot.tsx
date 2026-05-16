import { cn } from "@/lib/cn";
import { boxPlotStats } from "@/lib/stats";

export function MiniBoxPlot({ values, className }: { values: number[]; className?: string }) {
  const w = 240;
  const h = 70;
  const padX = 10;
  const midY = Math.round(h / 2);

  const stats = boxPlotStats(values);
  const min = Math.min(stats.min, stats.whiskerLow, ...stats.outliers);
  const max = Math.max(stats.max, stats.whiskerHigh, ...stats.outliers);
  const span = Math.max(1e-9, max - min);

  const x = (v: number) => padX + ((v - min) / span) * (w - padX * 2);

  const boxH = 18;
  const boxY = midY - Math.round(boxH / 2);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-[70px] w-full", className)} role="img" aria-label="box plot">
      {/* whiskers */}
      <line x1={x(stats.whiskerLow)} y1={midY} x2={x(stats.q1)} y2={midY} stroke="currentColor" opacity={0.5} strokeWidth={2} />
      <line x1={x(stats.q3)} y1={midY} x2={x(stats.whiskerHigh)} y2={midY} stroke="currentColor" opacity={0.5} strokeWidth={2} />
      <line x1={x(stats.whiskerLow)} y1={midY - 8} x2={x(stats.whiskerLow)} y2={midY + 8} stroke="currentColor" opacity={0.5} strokeWidth={2} />
      <line x1={x(stats.whiskerHigh)} y1={midY - 8} x2={x(stats.whiskerHigh)} y2={midY + 8} stroke="currentColor" opacity={0.5} strokeWidth={2} />

      {/* box */}
      <rect x={x(stats.q1)} y={boxY} width={Math.max(1, x(stats.q3) - x(stats.q1))} height={boxH} fill="none" stroke="currentColor" opacity={0.9} strokeWidth={2} />

      {/* median */}
      <line x1={x(stats.median)} y1={boxY} x2={x(stats.median)} y2={boxY + boxH} stroke="currentColor" opacity={0.9} strokeWidth={2} />

      {/* outliers */}
      {stats.outliers.slice(0, 24).map((v, i) => (
        <circle key={i} cx={x(v)} cy={midY} r={2.2} fill="currentColor" opacity={0.9} />
      ))}
    </svg>
  );
}

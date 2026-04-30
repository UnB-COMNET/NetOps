import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { AreaMini } from "@/components/viz/AreaMini";
import { cn } from "@/lib/cn";
import { coeffOfVariation, mean, variance } from "@/lib/stats";

export function MetricCard({
  title,
  value,
  unit,
  series,
  tone = "neutral",
}: {
  title: string;
  value: string;
  unit?: string;
  series: number[];
  tone?: "neutral" | "ok" | "danger";
}) {
  const avg = mean(series);
  const v = variance(series);
  const cv = coeffOfVariation(series);

  const varTone: "neutral" | "ok" | "danger" = cv < 0.15 ? "ok" : cv < 0.35 ? "neutral" : "danger";

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={title}
        right={<span className="font-mono text-[11px] text-fg-1">realtime</span>}
      />
      <CardBody className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <div className="font-mono text-[18px] font-semibold tracking-tight">{value}</div>
            {unit ? <div className="text-[11px] text-fg-1">{unit}</div> : null}
          </div>

          <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-fg-1">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-1/80">média</div>
              <div className="font-mono text-fg-0">{avg.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-1/80">var</div>
              <div className="font-mono text-fg-0">{v.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-fg-1/80">cv</div>
              <div
                className={cn(
                  "font-mono",
                  varTone === "ok" && "text-accent-ok",
                  varTone === "danger" && "text-accent-danger",
                  varTone === "neutral" && "text-fg-0",
                )}
              >
                {(cv * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          <div className="mt-1 text-[10px] text-fg-1">janela: {series.length} pts</div>
        </div>

        <div
          className={cn(
            "text-fg-1",
            tone === "ok" && "text-accent-ok",
            tone === "danger" && "text-accent-danger",
          )}
        >
          <AreaMini values={series} />
        </div>
      </CardBody>
    </Card>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";

// ─── Types ───────────────────────────────────────────────────────────────────

interface RunRecord {
  id: string;
  seed?: number;
  startedAt: string;
  endedAt?: string;
  status: string;
  config: {
    general: {
      name: string;
      durationS?: number;
      samplingMs?: number;
    };
  };
  metricKeys: string[];
  seriesMap: Record<string, number[]>;
  topology?: { switches?: number; hosts?: number };
  batch?: { repeatIndex?: number };
}

// ─── Stat helpers ─────────────────────────────────────────────────────────────

function percentile(arr: number[], p: number): number {
  if (!arr.length) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function computeStats(arr: number[]) {
  if (!arr.length) return { mean: NaN, std: NaN, min: NaN, max: NaN, p50: NaN, p95: NaN, p99: NaN, count: 0 };
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const std = Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
  return {
    mean, std,
    min: Math.min(...arr), max: Math.max(...arr),
    p50: percentile(arr, 50), p95: percentile(arr, 95), p99: percentile(arr, 99),
    count: arr.length,
  };
}

function fmt(v: number, d = 3): string {
  if (isNaN(v) || v == null) return "—";
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(2) + "k";
  return v.toFixed(d);
}

// ─── Color palette ────────────────────────────────────────────────────────────

const COLORS = [
  "#60a5fa", "#34d399", "#f59e0b", "#f87171",
  "#a78bfa", "#38bdf8", "#fb923c", "#e879f9",
];

// ─── SVG overlay chart ────────────────────────────────────────────────────────

function OverlayChart({ metricKey, runs, colors }: {
  metricKey: string;
  runs: RunRecord[];
  colors: Record<string, string>;
}) {
  const W = 600; const H = 160;
  const PAD = { t: 8, r: 12, b: 24, l: 44 };
  const cW = W - PAD.l - PAD.r;
  const cH = H - PAD.t - PAD.b;

  const allValues = runs.flatMap((r) => r.seriesMap[metricKey] ?? []);
  const globalMin = allValues.length ? Math.min(...allValues) : 0;
  const globalMax = allValues.length ? Math.max(...allValues) : 1;
  const span = Math.max(1e-9, globalMax - globalMin);
  const maxLen = Math.max(...runs.map((r) => (r.seriesMap[metricKey] ?? []).length));

  function toPath(values: number[]): string {
    if (!values.length) return "";
    const pts = values.map((v, i) => ({
      x: PAD.l + (i / Math.max(1, maxLen - 1)) * cW,
      y: PAD.t + (1 - (v - globalMin) / span) * cH,
    }));
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: PAD.t + (1 - t) * cH,
    label: fmt(globalMin + t * span, 2),
  }));

  const samplingMs = runs[0]?.config?.general?.samplingMs ?? 500;
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    x: PAD.l + t * cW,
    label: ((t * maxLen * samplingMs) / 1000).toFixed(1) + "s",
  }));

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }}>
        {yTicks.map((t, i) => (
          <line key={i} x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} stroke="rgba(80,100,140,0.2)" strokeWidth={1} />
        ))}
        {yTicks.map((t, i) => (
          <text key={i} x={PAD.l - 4} y={t.y + 3} textAnchor="end" fontSize={9} fill="rgba(160,170,200,0.7)">{t.label}</text>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 6} textAnchor="middle" fontSize={9} fill="rgba(160,170,200,0.7)">{t.label}</text>
        ))}
        {runs.map((run) => {
          const values = run.seriesMap[metricKey];
          if (!values?.length) return null;
          return (
            <path key={run.id} d={toPath(values)} fill="none" stroke={colors[run.id]} strokeWidth={1.8} opacity={0.9} />
          );
        })}
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="rgba(80,100,140,0.5)" strokeWidth={1} />
        <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="rgba(80,100,140,0.5)" strokeWidth={1} />
      </svg>
      <div className="mt-1 flex flex-wrap gap-3">
        {runs.map((run) => (
          <div key={run.id} className="flex items-center gap-1.5">
            <span className="h-2 w-6 rounded" style={{ background: colors[run.id] }} />
            <span className="font-mono text-[10px] text-fg-1">{run.config?.general?.name ?? run.id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stats table ──────────────────────────────────────────────────────────────

function StatsTable({ metricKey, runs, colors }: {
  metricKey: string;
  runs: RunRecord[];
  colors: Record<string, string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="border-b border-border-0/40 text-[9px] uppercase tracking-wide text-fg-1">
            {["Run","N","Média","Std","Min","P50","P95","P99","Max"].map((h) => (
              <th key={h} className="px-2 py-1 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const s = computeStats(run.seriesMap[metricKey] ?? []);
            return (
              <tr key={run.id} className="border-b border-border-0/20 hover:bg-bg-2/10">
                <td className="py-1 pr-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: colors[run.id] }} />
                    <span className="max-w-[110px] truncate font-mono text-[10px] text-fg-0">{run.config?.general?.name ?? run.id}</span>
                  </div>
                </td>
                {[s.count, s.mean, s.std, s.min, s.p50, s.p95, s.p99, s.max].map((v, i) => (
                  <td key={i} className="px-2 py-1 font-mono text-[10px] text-fg-0">{typeof v === "number" ? fmt(v) : v}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Run tag ──────────────────────────────────────────────────────────────────

function RunTag({ run, color, selected, onToggle }: {
  run: RunRecord; color: string; selected: boolean; onToggle: () => void;
}) {
  const d = new Date(run.startedAt);
  const dateStr = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
        selected ? "border-border-0/60 bg-bg-2/30" : "border-border-0/30 bg-bg-2/5 hover:bg-bg-2/15",
      )}
    >
      <span className="mt-0.5 h-3 w-3 flex-shrink-0 rounded-full" style={{ background: color, opacity: selected ? 1 : 0.35 }} />
      <div className="min-w-0">
        <div className="truncate font-mono text-[10px] font-semibold text-fg-0">{run.config?.general?.name ?? run.id}</div>
        <div className="text-[9px] text-fg-1">{dateStr} {timeStr} · {run.metricKeys.length} métr.</div>
        <div className={cn("font-mono text-[9px]", run.status === "Sucesso" ? "text-green-400" : "text-red-400")}>{run.status}</div>
      </div>
      {selected && (
        <span className="ml-auto flex-shrink-0 rounded-full border px-1 font-mono text-[8px]" style={{ borderColor: color, color }}>✓</span>
      )}
    </button>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ComparisonLab() {
  const [allRuns, setAllRuns] = useState<RunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(new Set());
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set());
  const [metricSearch, setMetricSearch] = useState("");

  useEffect(() => {
    fetch("/api/experiment/history")
      .then((r) => r.json())
      .then((data: RunRecord[]) => {
        const seen = new Set<string>();
        const unique = data.filter((r) => {
          const key = r.id + String(r.batch?.repeatIndex ?? "");
          if (seen.has(key)) return false;
          seen.add(key); return true;
        });
        setAllRuns(unique); setLoading(false);
      })
      .catch((e) => { setError(String(e)); setLoading(false); });
  }, []);

  const colorMap = useMemo(() => {
    const map: Record<string, string> = {};
    allRuns.forEach((r, i) => { map[r.id] = COLORS[i % COLORS.length]; });
    return map;
  }, [allRuns]);

  const selectedRuns = useMemo(() => allRuns.filter((r) => selectedRunIds.has(r.id)), [allRuns, selectedRunIds]);

  const availableMetrics = useMemo(() => {
    const all = new Set<string>();
    for (const run of selectedRuns) for (const k of run.metricKeys) all.add(k);
    return [...all].sort();
  }, [selectedRuns]);

  const filteredMetrics = useMemo(() =>
    !metricSearch.trim() ? availableMetrics : availableMetrics.filter((k) => k.toLowerCase().includes(metricSearch.toLowerCase())),
    [availableMetrics, metricSearch]
  );

  const activeMetrics = useMemo(() => availableMetrics.filter((k) => selectedMetrics.has(k)), [availableMetrics, selectedMetrics]);

  const toggleRun = useCallback((id: string) => {
    setSelectedRunIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
    setSelectedMetrics(new Set());
  }, []);

  const toggleMetric = useCallback((k: string) => {
    setSelectedMetrics((prev) => { const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next; });
  }, []);

  const exportCSV = useCallback(() => {
    if (!activeMetrics.length || !selectedRuns.length) return;
    const header = ["run_id","run_name","metric","n","mean","std","min","p50","p95","p99","max"];
    const rows = selectedRuns.flatMap((run) => activeMetrics.map((m) => {
      const s = computeStats(run.seriesMap[m] ?? []);
      return [run.id, run.config?.general?.name ?? run.id, m, s.count,
        s.mean.toFixed(4), s.std.toFixed(4), s.min.toFixed(4), s.p50.toFixed(4),
        s.p95.toFixed(4), s.p99.toFixed(4), s.max.toFixed(4)].join(",");
    }));
    const blob = new Blob([[header.join(","), ...rows].join("\n")], { type: "text/csv" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `comparison_${Date.now()}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }, [activeMetrics, selectedRuns]);

  const exportJSON = useCallback(() => {
    if (!activeMetrics.length || !selectedRuns.length) return;
    const out = selectedRuns.map((run) => ({
      id: run.id, name: run.config?.general?.name ?? run.id,
      startedAt: run.startedAt, status: run.status,
      metrics: Object.fromEntries(activeMetrics.map((m) => [m, {
        series: run.seriesMap[m] ?? [], stats: computeStats(run.seriesMap[m] ?? []),
      }])),
    }));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `comparison_${Date.now()}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  }, [activeMetrics, selectedRuns]);

  if (loading) return <div className="flex h-48 items-center justify-center text-[13px] text-fg-1">Carregando histórico…</div>;
  if (error) return <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-[13px] text-red-400">Erro: {error}</div>;

  return (
    <div className="flex h-[calc(100vh-7rem)] gap-3 overflow-hidden">
      {/* Left: Runs */}
      <div className="flex w-56 flex-shrink-0 flex-col gap-2 overflow-y-auto rounded-xl border border-border-0/60 bg-bg-1/30 p-2">
        <div className="px-1">
          <div className="text-[11px] font-semibold text-fg-0">Runs</div>
          <div className="text-[9px] text-fg-1">Selecione 2+ para comparar</div>
        </div>
        {allRuns.length === 0 ? (
          <div className="py-4 text-center text-[10px] text-fg-1">Nenhum run encontrado.</div>
        ) : (
          <div className="space-y-1">
            {allRuns.map((run) => (
              <RunTag key={run.id} run={run} color={colorMap[run.id]} selected={selectedRunIds.has(run.id)} onToggle={() => toggleRun(run.id)} />
            ))}
          </div>
        )}
      </div>

      {/* Center: Charts */}
      <div className="flex flex-1 flex-col gap-3 overflow-hidden">
        {selectedRuns.length < 2 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-border-0/40 bg-bg-1/20">
            <div className="text-5xl opacity-20">⚗️</div>
            <div className="text-[14px] font-semibold text-fg-0">Bancada de Análise Comparativa</div>
            <div className="max-w-sm text-center text-[12px] text-fg-1">
              Selecione pelo menos <strong className="text-fg-0">2 runs</strong> para iniciar a comparação.
            </div>
          </div>
        ) : (
          <>
            <div className="flex-shrink-0 rounded-xl border border-border-0/60 bg-bg-1/30 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-fg-0">{availableMetrics.length} métricas disponíveis</div>
                <div className="flex gap-1">
                  <button onClick={() => setSelectedMetrics(new Set(availableMetrics))} className="rounded border border-border-0/40 bg-bg-2/20 px-2 py-0.5 text-[10px] text-fg-1 hover:bg-bg-2/40">Todas</button>
                  <button onClick={() => setSelectedMetrics(new Set())} className="rounded border border-border-0/40 bg-bg-2/20 px-2 py-0.5 text-[10px] text-fg-1 hover:bg-bg-2/40">Limpar</button>
                </div>
              </div>
              <input type="text" value={metricSearch} onChange={(e) => setMetricSearch(e.target.value)}
                placeholder="Filtrar métricas…"
                className="mb-1.5 h-7 w-full rounded-md border border-border-0/60 bg-bg-2/50 px-2 text-[11px] text-fg-0 placeholder:text-fg-1/60 focus:outline-none focus:ring-1 focus:ring-accent-ok/40"
              />
              <div className="flex max-h-14 flex-wrap gap-1 overflow-y-auto">
                {filteredMetrics.map((k) => (
                  <button key={k} onClick={() => toggleMetric(k)}
                    className={cn("rounded border px-2 py-0.5 font-mono text-[10px] transition-colors",
                      selectedMetrics.has(k) ? "border-accent-ok/60 bg-accent-ok/15 text-accent-ok" : "border-border-0/40 bg-bg-2/20 text-fg-1 hover:bg-bg-2/40"
                    )}
                  >{k}</button>
                ))}
              </div>
            </div>
            {activeMetrics.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-border-0/40 text-[12px] text-fg-1">Selecione métricas acima.</div>
            ) : (
              <div className="flex-1 space-y-4 overflow-y-auto">
                {activeMetrics.map((m) => {
                  const runsWithMetric = selectedRuns.filter((r) => r.seriesMap[m]?.length);
                  return (
                    <div key={m} className="rounded-xl border border-border-0/60 bg-bg-1/30 p-3">
                      <div className="mb-2 font-mono text-[12px] font-semibold text-fg-0">{m}</div>
                      <OverlayChart metricKey={m} runs={runsWithMetric} colors={colorMap} />
                      <div className="mt-3 border-t border-border-0/30 pt-2">
                        <div className="mb-1 text-[9px] uppercase tracking-wide text-fg-1">Estatísticas descritivas</div>
                        <StatsTable metricKey={m} runs={runsWithMetric} colors={colorMap} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Right: Summary + Export */}
      <div className="flex w-48 flex-shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border border-border-0/60 bg-bg-1/30 p-2">
        <div>
          <div className="text-[11px] font-semibold text-fg-0">Sumário</div>
          <div className="mt-1.5 space-y-1 text-[11px] text-fg-1">
            <div className="flex justify-between"><span>Runs</span><span className="font-mono text-fg-0">{selectedRuns.length}</span></div>
            <div className="flex justify-between"><span>Métricas</span><span className="font-mono text-fg-0">{activeMetrics.length}</span></div>
          </div>
        </div>
        {selectedRuns.length > 0 && (
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wide text-fg-1">Ativos</div>
            <div className="space-y-1">
              {selectedRuns.map((run) => (
                <div key={run.id} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: colorMap[run.id] }} />
                  <span className="truncate font-mono text-[9px] text-fg-0">{run.config?.general?.name ?? run.id}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-auto space-y-1.5 border-t border-border-0/40 pt-2">
          <div className="text-[9px] uppercase tracking-wide text-fg-1">Exportar</div>
          <Button variant="ghost" className="w-full justify-start text-[10px]" onClick={exportCSV} disabled={!activeMetrics.length || !selectedRuns.length}>
            📄 CSV (estatísticas)
          </Button>
          <Button variant="ghost" className="w-full justify-start text-[10px]" onClick={exportJSON} disabled={!activeMetrics.length || !selectedRuns.length}>
            📦 JSON (séries + stats)
          </Button>
        </div>
        <div className="rounded-lg border border-border-0/30 bg-bg-2/10 p-2 text-[9px] leading-relaxed text-fg-1">
          <strong className="text-fg-0">Como usar:</strong><br />
          1. Selecione 2+ runs<br />
          2. Escolha métricas<br />
          3. Compare séries e stats<br />
          4. Exporte para paper
        </div>
      </div>
    </div>
  );
}

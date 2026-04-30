"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Sparkline } from "@/components/viz/Sparkline";
import { useRealtimeMetrics, type MetricHistory } from "@/hooks/useRealtimeMetrics";
import { cn } from "@/lib/cn";

// ─── Camadas OSI em ordem ──────────────────────────────────────────────────

const LAYER_ORDER = [
  "service",
  "application",
  "presentation",
  "session",
  "transport",
  "network",
  "dataplane",
  "link",
  "physical",
  "control",
] as const;

const LAYER_LABEL: Record<string, string> = {
  service:      "L7+ Service",
  application:  "L7 Application",
  presentation: "L6 Presentation",
  session:      "L5 Session",
  transport:    "L4 Transport",
  network:      "L3 Network",
  dataplane:    "Dataplane",
  link:         "L2 Link",
  physical:     "L1 Physical",
  control:      "Control Plane",
};

// ─── Severidade ────────────────────────────────────────────────────────────

function severity(m: MetricHistory): "ok" | "warn" | "danger" {
  const { metric, latest } = m;
  if (metric.includes("loss") && latest > 5) return "danger";
  if (metric.includes("loss") && latest > 1) return "warn";
  if (metric.includes("error") && latest > 50) return "danger";
  if (metric.includes("error") && latest > 10) return "warn";
  if (metric.includes("retrans") && latest > 15) return "danger";
  if (metric.includes("latency_ms") && latest > 200) return "danger";
  if (metric.includes("latency_ms") && latest > 80) return "warn";
  if (metric.includes("conn_ok") && latest === 0) return "danger";
  if (metric.includes("availability") && latest < 95) return "danger";
  if (metric.includes("availability") && latest < 99) return "warn";
  return "ok";
}

function badgeTone(sev: "ok" | "warn" | "danger"): "ok" | "neutral" | "danger" {
  if (sev === "danger") return "danger";
  if (sev === "warn") return "neutral";
  return "ok";
}

// ─── Formatar valor ────────────────────────────────────────────────────────

function fmtValue(metric: string, v: number): string {
  if (metric.includes("_pct") || metric.includes("availability")) return `${v.toFixed(2)}%`;
  if (metric.includes("_ms")) return `${v.toFixed(2)} ms`;
  if (metric.includes("_mbps") || metric.includes("_bps")) {
    if (v >= 1000) return `${(v / 1000).toFixed(2)} Gbps`;
    return `${v.toFixed(1)} Mbps`;
  }
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(2)}K`;
  return v.toFixed(v % 1 === 0 ? 0 : 2);
}

// ─── Card de uma métrica ───────────────────────────────────────────────────

function MetricCard({ m }: { m: MetricHistory }) {
  const sev = severity(m);
  const tone = badgeTone(sev);
  const value = fmtValue(m.metric, m.latest);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-1 border-b border-border-0/40 px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] text-fg-0" title={m.metric}>
            {m.metric}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-fg-1 truncate" title={m.node}>
            {m.node}
          </div>
        </div>
        <Badge tone={tone}>
          {sev === "danger" ? "🔴" : sev === "warn" ? "🟡" : "🟢"}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-2 px-2 py-2">
        <div className="font-mono text-sm font-semibold text-fg-0">{value}</div>
        <div className={cn(
          "text-fg-1",
          sev === "danger" && "text-red-400",
          sev === "warn" && "text-yellow-400",
          sev === "ok" && "text-emerald-400",
        )}>
          <Sparkline values={m.history.length > 1 ? m.history : [m.latest, m.latest]} className="h-8 w-[100px]" />
        </div>
      </div>
    </Card>
  );
}

// ─── Seção de camada ───────────────────────────────────────────────────────

function LayerSection({ layer, metrics }: { layer: string; metrics: MetricHistory[] }) {
  const dangerCount = metrics.filter((m) => severity(m) === "danger").length;
  const warnCount   = metrics.filter((m) => severity(m) === "warn").length;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <div className="font-mono text-[12px] font-semibold text-fg-0 uppercase tracking-wider">
          {LAYER_LABEL[layer] ?? layer}
        </div>
        <div className="font-mono text-[11px] text-fg-1">({metrics.length})</div>
        {dangerCount > 0 && (
          <Badge tone="danger">{dangerCount} crítico{dangerCount > 1 ? "s" : ""}</Badge>
        )}
        {warnCount > 0 && (
          <Badge tone="neutral">{warnCount} alerta{warnCount > 1 ? "s" : ""}</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
        {metrics.map((m) => (
          <MetricCard key={`${m.node}||${m.metric}`} m={m} />
        ))}
      </div>
    </div>
  );
}

// ─── MonitorView principal ─────────────────────────────────────────────────

export function MonitorView() {
  const { metrics, lastUpdated, online, loading, error } = useRealtimeMetrics();

  const [nodeFilter, setNodeFilter] = useState<string>("all");
  const [layerFilter, setLayerFilter] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [onlyAlerts, setOnlyAlerts] = useState(false);

  // Nós únicos para o filtro
  const nodes = useMemo(() => {
    const s = new Set(metrics.map((m) => m.node));
    return ["all", ...Array.from(s).sort()];
  }, [metrics]);

  // Métricas filtradas
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return metrics.filter((m) => {
      if (nodeFilter !== "all" && m.node !== nodeFilter) return false;
      if (layerFilter !== "all" && m.layer !== layerFilter) return false;
      if (q && !m.metric.toLowerCase().includes(q) && !m.node.toLowerCase().includes(q)) return false;
      if (onlyAlerts && severity(m) === "ok") return false;
      return true;
    });
  }, [metrics, nodeFilter, layerFilter, search, onlyAlerts]);

  // Agrupados por camada
  const byLayer = useMemo(() => {
    const map = new Map<string, MetricHistory[]>();
    for (const m of filtered) {
      const arr = map.get(m.layer) ?? [];
      arr.push(m);
      map.set(m.layer, arr);
    }
    return map;
  }, [filtered]);

  // Ordenar camadas conforme LAYER_ORDER
  const orderedLayers = useMemo(() => {
    const known = LAYER_ORDER.filter((l) => byLayer.has(l));
    const extra = Array.from(byLayer.keys()).filter((l) => !LAYER_ORDER.includes(l as any));
    return [...known, ...extra];
  }, [byLayer]);

  // Totais de alertas
  const totalDanger = metrics.filter((m) => severity(m) === "danger").length;
  const totalWarn   = metrics.filter((m) => severity(m) === "warn").length;

  return (
    <div className="space-y-4">
      {/* Barra de status topo */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-0/60 bg-bg-1/40 px-3 py-2">
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex items-center gap-1.5 font-mono text-[12px]",
              online ? "text-emerald-400" : "text-yellow-400",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full", online ? "bg-emerald-400 animate-pulse" : "bg-yellow-400")} />
            {online ? "LIVE" : loading ? "conectando…" : "offline"}
          </span>
          {lastUpdated && (
            <span className="font-mono text-[11px] text-fg-1">
              última atualização: {lastUpdated}
            </span>
          )}
          <span className="font-mono text-[11px] text-fg-1">
            {metrics.length} métricas · {metrics.filter(m => severity(m) !== "ok").length} alertas
          </span>
        </div>
        <div className="flex items-center gap-2">
          {totalDanger > 0 && <Badge tone="danger">{totalDanger} crítico{totalDanger > 1 ? "s" : ""}</Badge>}
          {totalWarn > 0   && <Badge tone="neutral">{totalWarn} alerta{totalWarn > 1 ? "s" : ""}</Badge>}
          {totalDanger === 0 && totalWarn === 0 && metrics.length > 0 && (
            <Badge tone="ok">Todos normais</Badge>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 font-mono text-[11px] text-yellow-300">
          {error}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 rounded-xl border border-border-0/60 bg-bg-1/40 px-3 py-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-fg-1">Nó</label>
          <select
            className="rounded-lg border border-border-0/60 bg-bg-2/40 px-2 py-1 font-mono text-[11px] text-fg-0 focus:outline-none"
            value={nodeFilter}
            onChange={(e) => setNodeFilter(e.target.value)}
          >
            {nodes.map((n) => (
              <option key={n} value={n}>{n === "all" ? "Todos os nós" : n}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-fg-1">Camada</label>
          <select
            className="rounded-lg border border-border-0/60 bg-bg-2/40 px-2 py-1 font-mono text-[11px] text-fg-0 focus:outline-none"
            value={layerFilter}
            onChange={(e) => setLayerFilter(e.target.value)}
          >
            <option value="all">Todas</option>
            {LAYER_ORDER.map((l) => (
              <option key={l} value={l}>{LAYER_LABEL[l]}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-fg-1">Buscar</label>
          <input
            type="text"
            placeholder="métrica ou nó…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-lg border border-border-0/60 bg-bg-2/40 px-2 py-1 font-mono text-[11px] text-fg-0 placeholder:text-fg-1 focus:outline-none"
          />
        </div>

        <div className="flex flex-col justify-end gap-1">
          <label className="text-[10px] text-fg-1">&nbsp;</label>
          <button
            onClick={() => setOnlyAlerts((v) => !v)}
            className={cn(
              "rounded-lg border px-3 py-1 font-mono text-[11px] transition-colors",
              onlyAlerts
                ? "border-red-500/60 bg-red-500/20 text-red-300"
                : "border-border-0/60 bg-bg-2/40 text-fg-1 hover:text-fg-0",
            )}
          >
            {onlyAlerts ? "🔴 Só alertas" : "Mostrar alertas"}
          </button>
        </div>
      </div>

      {/* Conteúdo */}
      {loading && metrics.length === 0 ? (
        <div className="flex items-center justify-center py-16 font-mono text-[12px] text-fg-1">
          <span className="animate-pulse">Carregando métricas em tempo real…</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border-0/60 bg-bg-1/40 px-4 py-8 text-center font-mono text-[12px] text-fg-1">
          Nenhuma métrica encontrada com os filtros atuais.
        </div>
      ) : (
        <div className="space-y-6">
          {orderedLayers.map((layer) => {
            const layerMetrics = byLayer.get(layer);
            if (!layerMetrics || layerMetrics.length === 0) return null;
            // Ordenar: danger > warn > ok, depois por nome
            const sorted = [...layerMetrics].sort((a, b) => {
              const sa = severity(a) === "danger" ? 0 : severity(a) === "warn" ? 1 : 2;
              const sb = severity(b) === "danger" ? 0 : severity(b) === "warn" ? 1 : 2;
              if (sa !== sb) return sa - sb;
              return a.metric.localeCompare(b.metric);
            });
            return <LayerSection key={layer} layer={layer} metrics={sorted} />;
          })}
        </div>
      )}
    </div>
  );
}

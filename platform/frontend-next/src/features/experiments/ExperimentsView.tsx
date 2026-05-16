"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { MultiSparkline } from "@/components/viz/MultiSparkline";
import { MiniBoxPlot } from "@/components/viz/MiniBoxPlot";
import { MiniScatter } from "@/components/viz/MiniScatter";
import { templates, type ExperimentTemplate, type ManualExperimentConfig, type RateUnit, type TrafficType } from "@/features/experiments/data";
import { getLayerMetrics, type MetricLayer, type MetricSpec } from "@/lib/metricsCatalog";
import { cn } from "@/lib/cn";
import { simulateSeriesMap, buildDatasetRows, datasetToCsv, type SeriesMap } from "@/lib/metricSim";
import { simulateControlPlaneLog, type ControlPlaneEvent } from "@/lib/controlPlaneSim";
import { lttbSeriesMap } from "@/lib/lttb";
import { confidenceInterval95, mean, median, outlierIndicesZ, p95, p99, pearsonR, stddev, variance } from "@/lib/stats";
import { experimentApi, topologyApi, metricsApi, type MetricSample, type ExperimentBundle, API_BASE } from "@/lib/api";
import {
  fsSupportedInBrowser,
  saveDirHandle as persistDirHandle,
  loadDirHandle,
  clearDirHandle,
  requestPermission,
  writeJsonToDir,
  readJsonFilesFromDir,
} from "@/lib/fsStorage";

type Tab = "manual" | "templates" | "dashboard";

type RunStatus = "idle" | "running" | "paused" | "success" | "failed";

type Annotation = { tMs: number; label: string };

type TopologySnapshotSummary = {
  capturedAt: string;
  name?: string;
  mode?: "logical" | "physical";
  nodes?: number;
  edges?: number;
};

type RunRecord = {
  id: string;
  seed: number;
  startedAt: string;
  endedAt: string;
  status: "Sucesso" | "Falha";
  config: ManualExperimentConfig;

  templateId?: string | null;
  metricKeys: string[];
  seriesMap?: SeriesMap;
  annotations?: Annotation[];
  controlPlane?: ControlPlaneEvent[];
  topology?: TopologySnapshotSummary | null;
  insight?: string;

  batch?:
    | {
        variable: "traffic.rateValue";
        index: number;
        total: number;
        start: number;
        step: number;
        unit: RateUnit;
      }
    | null;
};

const HOST_IDS = ["Host-A", "Host-B", "Host-C", "Host-D"];

const L0_L7: Array<Extract<MetricLayer, "L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7">> = [
  "L0",
  "L1",
  "L2",
  "L3",
  "L4",
  "L5",
  "L6",
  "L7",
];

function nowIso() {
  return new Date().toISOString();
}

// Helper seguro para localStorage que não falha durante navegação Next.js
function safeLocalStorage() {
  try {
    if (typeof window !== "undefined" && typeof localStorage !== "undefined" && localStorage) {
      return localStorage;
    }
  } catch (e) {
    console.warn("[safeLocalStorage] localStorage not available:", e);
  }
  return null;
}

// Funções auxiliares para persistência via API (sistema de arquivos)
async function saveRunStateToBackend(state: any) {
  try {
    await fetch(`${API_BASE}/experiment/run-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch (e) {
    console.warn("[saveRunStateToBackend] Failed:", e);
  }
}

async function loadRunStateFromBackend(): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/experiment/run-state`);
    if (response.ok) {
      return await response.json();
    }
  } catch (e) {
    console.warn("[loadRunStateFromBackend] Failed:", e);
  }
  return {};
}

async function saveSelectedMetricsToBackend(metricKeys: string[]) {
  try {
    await fetch(`${API_BASE}/experiment/selected-metrics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricKeys }),
    });
  } catch (e) {
    console.warn("[saveSelectedMetricsToBackend] Failed:", e);
  }
}

async function loadSelectedMetricsFromBackend(): Promise<string[]> {
  try {
    const response = await fetch(`${API_BASE}/experiment/selected-metrics`);
    if (response.ok) {
      const data = await response.json();
      return data.metricKeys || [];
    }
  } catch (e) {
    console.warn("[loadSelectedMetricsFromBackend] Failed:", e);
  }
  return [];
}

function makeRunId() {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function downloadTextFile({ filename, content, mime }: { filename: string; content: string; mime: string }) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(s: string) {
  return (s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeLatex(input: string) {
  const placeholder = "__NETOPS_BSLASH__";
  return (input ?? "")
    .replaceAll("\\", placeholder)
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("$", "\\$")
    .replaceAll("&", "\\&")
    .replaceAll("#", "\\#")
    .replaceAll("_", "\\_")
    .replaceAll("%", "\\%")
    .replaceAll("~", "\\textasciitilde{}")
    .replaceAll("^", "\\textasciicircum{}")
    .replaceAll(placeholder, "\\textbackslash{}");
}

function escapeMd(input: string) {
  return (input ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function safeNumber(n: unknown, fallback: number) {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function formatRemaining(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function formatMetricValue(spec: MetricSpec, raw: number) {
  if (spec.kind === "bool") return raw > 0.5 ? "1" : "0";

  if (spec.unit === "%") return `${raw.toFixed(0)}%`;
  if (spec.unit === "ms") return `${raw.toFixed(1)} ms`;
  if (spec.unit === "dBm") return `${raw.toFixed(2)} dBm`;
  if (spec.unit === "Mbps") {
    if (raw >= 1000) return `${(raw / 1000).toFixed(2)} Gbps`;
    return `${raw.toFixed(1)} Mbps`;
  }
  if (spec.unit === "bps") {
    if (raw >= 1e9) return `${(raw / 1e9).toFixed(2)} Gbps`;
    if (raw >= 1e6) return `${(raw / 1e6).toFixed(2)} Mbps`;
    if (raw >= 1e3) return `${(raw / 1e3).toFixed(2)} Kbps`;
    return `${raw.toFixed(0)} bps`;
  }
  if (raw >= 1e9) return `${(raw / 1e9).toFixed(2)}e9`;
  if (raw >= 1e6) return `${(raw / 1e6).toFixed(2)}e6`;
  if (raw >= 1e3) return `${(raw / 1e3).toFixed(2)}e3`;
  return raw.toFixed(2);
}

function readRunHistory(): RunRecord[] {
  // Legado: tenta ler do localStorage como fallback (pode estar vazio)
  try {
    const ls = safeLocalStorage();
    const raw = ls?.getItem("netops.experiments.runs");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RunRecord[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((r) => r && typeof r === "object" && typeof (r as any).id === "string")
      .map((r) => {
        const rr = r as any;
        const cfg = rr.config as ManualExperimentConfig;
        return {
          id: rr.id,
          seed: safeNumber(rr.seed, hashSeed(String(rr.id))),
          startedAt: typeof rr.startedAt === "string" ? rr.startedAt : nowIso(),
          endedAt: typeof rr.endedAt === "string" ? rr.endedAt : nowIso(),
          status: rr.status === "Falha" ? "Falha" : "Sucesso",
          config: cfg,
          templateId: typeof rr.templateId === "string" ? rr.templateId : rr.templateId === null ? null : undefined,
          metricKeys: Array.isArray(rr.metricKeys) ? rr.metricKeys.filter((k: any) => typeof k === "string") : cfg?.telemetry?.metricKeys ?? [],
          seriesMap: rr.seriesMap && typeof rr.seriesMap === "object" ? (rr.seriesMap as SeriesMap) : undefined,
          annotations: Array.isArray(rr.annotations) ? (rr.annotations as Annotation[]) : undefined,
          controlPlane: Array.isArray(rr.controlPlane) ? (rr.controlPlane as ControlPlaneEvent[]) : undefined,
          topology: rr.topology && typeof rr.topology === "object" ? (rr.topology as TopologySnapshotSummary) : rr.topology === null ? null : undefined,
          insight: typeof rr.insight === "string" ? rr.insight : undefined,
          batch: rr.batch && typeof rr.batch === "object" ? rr.batch : rr.batch === null ? null : undefined,
        } satisfies RunRecord;
      });
  } catch {
    return [];
  }
}

function normalizeRunRecord(rr: any): RunRecord {
  const cfg = rr.config as ManualExperimentConfig;
  return {
    id: rr.id,
    seed: safeNumber(rr.seed, hashSeed(String(rr.id))),
    startedAt: typeof rr.startedAt === "string" ? rr.startedAt : nowIso(),
    endedAt: typeof rr.endedAt === "string" ? rr.endedAt : nowIso(),
    status: rr.status === "Falha" ? "Falha" : "Sucesso",
    config: cfg,
    templateId: typeof rr.templateId === "string" ? rr.templateId : rr.templateId === null ? null : undefined,
    metricKeys: Array.isArray(rr.metricKeys) ? rr.metricKeys.filter((k: any) => typeof k === "string") : cfg?.telemetry?.metricKeys ?? [],
    seriesMap: rr.seriesMap && typeof rr.seriesMap === "object" ? (rr.seriesMap as SeriesMap) : undefined,
    annotations: Array.isArray(rr.annotations) ? (rr.annotations as Annotation[]) : undefined,
    controlPlane: Array.isArray(rr.controlPlane) ? (rr.controlPlane as ControlPlaneEvent[]) : undefined,
    topology: rr.topology && typeof rr.topology === "object" ? (rr.topology as TopologySnapshotSummary) : rr.topology === null ? null : undefined,
    insight: typeof rr.insight === "string" ? rr.insight : undefined,
    batch: rr.batch && typeof rr.batch === "object" ? rr.batch : rr.batch === null ? null : undefined,
  } satisfies RunRecord;
}

async function readRunHistoryFromBackend(): Promise<RunRecord[]> {
  try {
    const response = await fetch(`${API_BASE}/experiment/history`);
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data)) {
        return data
          .filter((r: any) => r && typeof r === "object" && typeof r.id === "string")
          .map(normalizeRunRecord);
      }
    }
  } catch (e) {
    console.warn("[readRunHistoryFromBackend] Failed:", e);
  }
  return [];
}

async function appendRunRecordToBackend(record: RunRecord): Promise<void> {
  try {
    await fetch(`${API_BASE}/experiment/history/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    console.log("[appendRunRecordToBackend] ✅ Record saved:", record.id);
  } catch (e) {
    console.warn("[appendRunRecordToBackend] Failed:", e);
  }
}

/**
 * Persists run history to localStorage using LTTB downsampling.
 *
 * LTTB (Largest-Triangle-Three-Buckets) is O(n) and preserves the visual
 * shape of each series far better than uniform sub-sampling — peaks, valleys
 * and anomalies are never dropped.
 *
 * Budget ladder (attempted in order until one succeeds):
 *   1. Full data — no downsampling (works for short experiments)
 *   2. LTTB to fit ~1 MB total across all series of all runs
 *   3. LTTB to fit ~200 KB  (aggressive but still useful preview)
 *   4. Drop seriesMap entirely — charts re-simulate from the deterministic seed
 *   5. Keep only the 10 most recent runs without series (last resort)
 *
 * The authoritative record is always in experiments/run_metrics/ on disk.
 */
function writeRunHistory(next: RunRecord[]) {
  // Agora apenas salva via backend (veja appendRunRecordToBackend para novos registros)
  // Esta função é mantida para compatibilidade mas não faz nada crítico
  const MAX_RUNS = 100;
  const runs = next.slice(0, MAX_RUNS);

  // Tentar salvar no localStorage como cache local (não crítico)
  const ls = safeLocalStorage();
  if (ls) {
    try {
      ls.setItem("netops.experiments.runs", JSON.stringify(
        runs.map((r) => ({ ...r, seriesMap: undefined })) // sem seriesMap para economizar espaço
      ));
    } catch { /* ignora erros de quota */ }
  }
  
  // Salvar no backend via fetch assíncrono
  fetch(`${API_BASE}/experiment/history`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runs),
  }).catch((e) => console.warn("[writeRunHistory] Backend save failed:", e));
}

function readLatestTopologySummary(): TopologySnapshotSummary | null {
  try {
    const ls = safeLocalStorage();
    const raw = ls?.getItem("netops.topology.snapshots");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any[];
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const last = parsed[0];
    if (!last || typeof last !== "object") return null;
    const capturedAt = typeof last.capturedAt === "string" ? last.capturedAt : nowIso();
    const name = typeof last.name === "string" ? last.name : undefined;
    const mode = last.mode === "logical" || last.mode === "physical" ? last.mode : undefined;
    const nodes = Array.isArray(last.nodes) ? last.nodes.length : typeof last.nodesCount === "number" ? last.nodesCount : undefined;
    const edges = Array.isArray(last.edges) ? last.edges.length : typeof last.edgesCount === "number" ? last.edgesCount : undefined;
    return { capturedAt, name, mode, nodes, edges };
  } catch {
    return null;
  }
}

function ProgressRing({ pct }: { pct: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const p = clamp(pct, 0, 100);
  const dash = (p / 100) * c;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className="shrink-0">
      <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(var(--border-0))" strokeOpacity={0.35} strokeWidth="4" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="rgb(var(--accent-ok))"
        strokeWidth="4"
        strokeDasharray={`${dash} ${c - dash}`}
        strokeLinecap="round"
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}

function ExperimentMetricCard({
  spec,
  series,
  markers,
}: {
  spec: MetricSpec;
  series: number[];
  markers?: Array<{ index: number; label?: string }>;
}) {
  const [viz, setViz] = useState<"line" | "box">("line");
  const [showOutliers, setShowOutliers] = useState<boolean>(true);

  const last = series[series.length - 1] ?? spec.sim.initial;
  const isUp = spec.kind === "bool" ? last > 0.5 : null;
  const tone: "neutral" | "ok" | "danger" = spec.kind === "bool" ? (isUp ? "ok" : "danger") : "neutral";

  const outIdx = useMemo(
    () => (showOutliers && spec.kind !== "bool" ? outlierIndicesZ(series, 3) : []),
    [series, showOutliers, spec.kind],
  );
  const ci = useMemo(() => confidenceInterval95(series), [series]);
  const stats = useMemo(
    () => ({
      mean: mean(series),
      median: median(series),
      std: stddev(series),
      var: variance(series),
      p95: p95(series),
      p99: p99(series),
      ci,
    }),
    [ci, series],
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-2 border-b border-border-0/50 px-2 py-1.5">
        <div className="min-w-0">
          <div className="truncate font-mono text-[11px] text-fg-0">{spec.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-1">
            <span className="font-mono">{spec.layer}</span>
            <span className="font-mono">{spec.type}</span>
            <span className="font-mono">{spec.unit ?? "—"}</span>
          </div>
        </div>
        <Select value={viz} onChange={(e) => setViz(e.target.value as any)}>
          <option value="line">Linha</option>
          <option value="box">Box</option>
        </Select>
      </div>

      <div className="px-2 py-2">
        <div className="flex items-center justify-center gap-2">
          {spec.kind === "bool" ? (
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full ring-1 ring-border-0/60",
                tone === "ok" && "bg-accent-ok",
                tone === "danger" && "bg-accent-danger",
              )}
              aria-label={tone === "ok" ? "Up" : "Down"}
              title={tone === "ok" ? "Up" : "Down"}
            />
          ) : null}

          <div className="text-center">
            <div className="font-mono text-sm text-fg-0">{spec.kind === "bool" ? (isUp ? "Up" : "Down") : formatMetricValue(spec, last)}</div>
            <div className="mt-0.5 text-[10px] text-fg-1">{spec.category}</div>
          </div>
        </div>

        <div className={cn("mt-2 text-fg-1", tone === "ok" && "text-accent-ok", tone === "danger" && "text-accent-danger")}>
          <div className="group relative rounded-md border border-border-0/50 bg-bg-2/10 p-1">
            {viz === "box" ? (
              <MiniBoxPlot values={series} />
            ) : (
              <MultiSparkline
                series={[{ id: spec.key, values: series }]}
                markers={markers}
                outliersById={showOutliers ? { [spec.key]: outIdx } : undefined}
              />
            )}

            <div className="pointer-events-none absolute right-1 top-1 hidden w-[220px] rounded-md border border-border-0/60 bg-bg-0/95 p-2 text-[10px] text-fg-1 shadow-sm group-hover:block">
              <div className="mb-1 font-mono text-[10px] text-fg-0">stats (n={stats.ci.n})</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
                <div>
                  média <span className="font-mono text-fg-0">{stats.mean.toFixed(3)}</span>
                </div>
                <div>
                  mediana <span className="font-mono text-fg-0">{stats.median.toFixed(3)}</span>
                </div>
                <div>
                  σ <span className="font-mono text-fg-0">{stats.std.toFixed(3)}</span>
                </div>
                <div>
                  var <span className="font-mono text-fg-0">{stats.var.toFixed(3)}</span>
                </div>
                <div>
                  p95 <span className="font-mono text-fg-0">{stats.p95.toFixed(3)}</span>
                </div>
                <div>
                  p99 <span className="font-mono text-fg-0">{stats.p99.toFixed(3)}</span>
                </div>
                <div className="col-span-2">
                  IC95% <span className="font-mono text-fg-0">{stats.ci.low.toFixed(3)} – {stats.ci.high.toFixed(3)}</span>
                </div>
              </div>
            </div>
          </div>

          {spec.kind !== "bool" ? (
            <label className="mt-1 flex cursor-pointer items-center justify-end gap-2 text-[10px] text-fg-1">
              <input type="checkbox" checked={showOutliers} onChange={(e) => setShowOutliers(e.target.checked)} />
              Outliers (|z|≥3)
            </label>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function MetricRow({
  spec,
  checked,
  onToggle,
}: {
  spec: MetricSpec;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start justify-between gap-3 rounded-md border border-border-0/60 bg-bg-2/10 px-2 py-1.5",
        "hover:bg-bg-2/20",
      )}
    >
      <div className="min-w-0">
        <div className="font-mono text-[11px] text-fg-0">{spec.name}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-fg-1">
          <span className="font-mono">{spec.key}</span>
          <span className="font-mono">{spec.category}</span>
          <span className="font-mono">{spec.type}</span>
          <span className="font-mono">{spec.unit ?? "—"}</span>
        </div>
      </div>
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1" />
    </label>
  );
}

function LayerGroup({
  layer,
  selectedKeys,
  setSelectedKeys,
}: {
  layer: typeof L0_L7[number];
  selectedKeys: Set<string>;
  setSelectedKeys: (next: Set<string>) => void;
}) {
  const specs = useMemo(() => getLayerMetrics(layer), [layer]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return specs;
    const q = search.toLowerCase();
    return specs.filter((s) => s.key.toLowerCase().includes(q) || s.name.toLowerCase().includes(q));
  }, [specs, search]);

  const selectedCount = useMemo(() => {
    let c = 0;
    for (const s of specs) if (selectedKeys.has(s.key)) c++;
    return c;
  }, [selectedKeys, specs]);

  const allSelected = specs.length > 0 && selectedCount === specs.length;
  const noneSelected = selectedCount === 0;

  return (
    <div className="rounded-lg border border-border-0/60 bg-bg-1/30">
      {/* Header — always visible */}
      <div
        className="flex cursor-pointer items-center justify-between gap-2 px-2 py-1.5 select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-fg-1">{open ? "▾" : "▸"}</span>
          <div className="font-mono text-[11px] font-semibold text-fg-0">{layer}</div>
          <div className="text-[10px] text-fg-1">{selectedCount}/{specs.length}</div>
          {selectedCount > 0 && (
            <span className="rounded-md border border-accent-ok/40 bg-accent-ok/10 px-1.5 py-0.5 font-mono text-[9px] text-accent-ok">
              {selectedCount} sel
            </span>
          )}
        </div>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-fg-1"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => {
              if (el) el.indeterminate = !allSelected && !noneSelected;
            }}
            onChange={(e) => {
              const next = new Set(selectedKeys);
              if (e.target.checked) for (const s of specs) next.add(s.key);
              else for (const s of specs) next.delete(s.key);
              setSelectedKeys(next);
            }}
          />
          Todas
        </label>
      </div>

      {/* Collapsible body */}
      {open && (
        <div className="border-t border-border-0/50">
          {/* Search inside layer */}
          <div className="px-2 pt-1.5 pb-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar métricas…"
              className="h-7 w-full rounded-md border border-border-0/60 bg-bg-2/50 px-2 text-[11px] text-fg-0 placeholder:text-fg-1/60 focus:outline-none focus:ring-1 focus:ring-accent-ok/40"
            />
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto p-2 pt-0">
            {filtered.length === 0 ? (
              <div className="py-2 text-center text-[10px] text-fg-1">Nenhuma métrica encontrada</div>
            ) : (
              filtered.map((spec) => (
                <MetricRow
                  key={spec.key}
                  spec={spec}
                  checked={selectedKeys.has(spec.key)}
                  onToggle={() => {
                    const next = new Set(selectedKeys);
                    if (next.has(spec.key)) next.delete(spec.key);
                    else next.add(spec.key);
                    setSelectedKeys(next);
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateCard({ t, onCloneAndEdit }: { t: ExperimentTemplate; onCloneAndEdit: () => void }) {
  return (
    <Card>
      <CardHeader title={t.name} right={<span className="font-mono">template</span>} />
      <CardBody className="space-y-3">
        <div className="text-[12px] text-fg-1">{t.description}</div>
        <div className="grid grid-cols-1 gap-2">
          <div className="rounded-lg border border-border-0/60 bg-bg-2/10 p-2 text-[11px] text-fg-1">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-1">Camadas monitoradas</div>
            <div className="flex flex-wrap gap-1">
              {t.monitoredLayers.map((l) => (
                <span key={l} className="rounded-md border border-border-0/60 bg-bg-2/20 px-2 py-0.5 font-mono text-[10px] text-fg-0">
                  {l}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border-0/60 bg-bg-2/10 p-2 text-[11px] text-fg-1">
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-1">Topologia exigida</div>
            <div className="font-mono text-[11px] text-fg-0">
              hosts={t.requiredTopology.hosts} · switches={t.requiredTopology.switches} · controllers={t.requiredTopology.controllers}
            </div>
          </div>
        </div>

        <Button onClick={onCloneAndEdit}>Clonar e Editar</Button>
      </CardBody>
    </Card>
  );
}

export function ExperimentsView() {
  // Teste de localStorage no pywebview
  useEffect(() => {
    if (typeof window !== "undefined") {
      console.log("=".repeat(50));
      console.log("[DESKTOP DEBUG] ExperimentsView mounted!");
      const ls = safeLocalStorage();
      console.log("[DESKTOP DEBUG] localStorage available?", ls !== null);
      console.log("[DESKTOP DEBUG] window.__netopsTimers?", (window as any).__netopsTimers);
      
      try {
        // Teste de leitura/escrita
        let test: string | null = null;
        let metrics: string | null = null;
        let runState: string | null = null;
        let configState: string | null = null;
        
        if (ls) {
          ls.setItem("netops.test", "working");
          test = ls.getItem("netops.test");
          console.log("[DESKTOP DEBUG] localStorage works?", test === "working" ? "YES" : "NO");
          
          // Verificar itens salvos
          metrics = ls.getItem("netops.experiments.selectedMetrics");
          runState = ls.getItem("netops.experiments.runState");
          configState = ls.getItem("netops.experiments.currentConfig");
        }
        console.log("[DESKTOP DEBUG] Saved metrics?", metrics ? `YES (${JSON.parse(metrics).length} keys)` : "NO");
        console.log("[DESKTOP DEBUG] Saved run state?", runState ? `YES (status: ${JSON.parse(runState).runStatus})` : "NO");
        console.log("[DESKTOP DEBUG] Saved config?", configState ? `YES (name: ${JSON.parse(configState).general.name})` : "NO");
      } catch (e) {
        console.error("[DESKTOP DEBUG] localStorage test error:", e);
      }
      console.log("=".repeat(50));
    }
  }, []);

  const [tab, setTab] = useState<Tab>("manual");

  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);

  const [config, setConfig] = useState<ManualExperimentConfig>(() => {
    // Carregar config salvo do localStorage (apenas no cliente)
    if (typeof window !== "undefined") {
      try {
        const ls = safeLocalStorage();
        const saved = ls?.getItem("netops.experiments.currentConfig");
        if (saved) {
          const parsed = JSON.parse(saved);
          console.log("[ExperimentsView] Config loaded from localStorage:", parsed.general.name);
          return parsed;
        }
      } catch (e) {
        console.warn("Failed to load saved config", e);
      }
    }
    console.log("[ExperimentsView] Using default config");
    return {
      general: {
        name: "Experimento Manual",
        scientificDescription: "",
        durationS: 120,
        samplingMs: 250,
        repeatCount: 1, // Número de repetições do experimento
      },
      traffic: {
        srcHostId: HOST_IDS[0]!,
        dstHostId: HOST_IDS[3]!,
        type: "TCP",
        rateValue: 300,
        rateUnit: "Mbps",
      },
      telemetry: { metricKeys: [] },
      scripts: { pre: "", post: "" },
    };
  });

  // Função helper que atualiza config E salva imediatamente no localStorage + API
  const updateConfig = useCallback((updater: (prev: ManualExperimentConfig) => ManualExperimentConfig) => {
    setConfig((prev) => {
      const next = updater(prev);
      // Salvar imediatamente no localStorage
      try {
        const ls = safeLocalStorage();
        if (ls) {
          ls.setItem("netops.experiments.currentConfig", JSON.stringify(next));
          console.log("[ExperimentsView] Config saved to localStorage:", next.general.name);
        }
      } catch (e) {
        console.error("Failed to save config to localStorage", e);
      }
      // Salvar também via API (backup para pywebview)
      fetch(`${API_BASE}/experiment/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      }).catch((e) => console.warn("Failed to save config to API", e));
      return next;
    });
  }, []);

  // Carregar config da API ao montar o componente (fallback se localStorage falhar)
  useEffect(() => {
    const loadFromApi = async () => {
      try {
        // Só carregar da API se o localStorage estiver com config padrão
        if (config.general.name === "Experimento Manual" && config.general.scientificDescription === "") {
          const response = await fetch(`${API_BASE}/experiment/draft`);
          if (response.ok) {
            const draft = await response.json();
            if (draft && draft.general && draft.general.name) {
              console.log("[ExperimentsView] Config loaded from API:", draft.general.name);
              setConfig(draft);
              // Sincronizar com localStorage
              const ls = safeLocalStorage();
              if (ls) {
                ls.setItem("netops.experiments.currentConfig", JSON.stringify(draft));
              }
            }
          }
        }
      } catch (e) {
        console.warn("Failed to load config from API", e);
      }
    };
    loadFromApi();
  }, []); // Executar apenas uma vez ao montar

  const [selectedMetricKeys, setSelectedMetricKeys] = useState<Set<string>>(new Set());
  
  // Carregar métricas selecionadas do backend
  useEffect(() => {
    const loadMetrics = async () => {
      const keys = await loadSelectedMetricsFromBackend();
      if (keys.length > 0) {
        console.log("[ExperimentsView] ✅ Loaded selected metrics from backend:", keys.length, "keys");
        setSelectedMetricKeys(new Set(keys));
      }
    };
    loadMetrics();
  }, []);
  
  useEffect(() => {
    const keysArray = Array.from(selectedMetricKeys);
    setConfig((p) => ({ ...p, telemetry: { metricKeys: keysArray } }));
    // Salvar métricas selecionadas no backend
    if (keysArray.length > 0) {
      saveSelectedMetricsToBackend(keysArray);
      console.log("[ExperimentsView] Saved selected metrics to backend:", selectedMetricKeys.size, "keys");
    }
  }, [selectedMetricKeys]);

  const [validation, setValidation] = useState<string | null>(null);

  // Estados de execução - iniciar vazio e carregar do backend no useEffect
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runId, setRunId] = useState<string | null>(null);
  const [runStartMs, setRunStartMs] = useState<number | null>(null);
  const [runRemainingMs, setRunRemainingMs] = useState<number>(0);
  const [currentRepeat, setCurrentRepeat] = useState<number>(1);
  const [totalRepeats, setTotalRepeats] = useState<number>(1);
  const [logs, setLogs] = useState<string[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [eventLabel, setEventLabel] = useState<string>("");
  // Histórico carregado do backend via useEffect
  const [history, setHistory] = useState<RunRecord[]>([]);

  const [batchEnabled, setBatchEnabled] = useState<boolean>(false);
  const [batchCount, setBatchCount] = useState<number>(5);
  const [batchStep, setBatchStep] = useState<number>(10);

  const [selectedHistoryIds, setSelectedHistoryIds] = useState<Set<string>>(() => new Set());
  const [compareOpen, setCompareOpen] = useState<boolean>(false);
  const [compareMetricKey, setCompareMetricKey] = useState<string>("");
  const [compareOutliers, setCompareOutliers] = useState<boolean>(true);
  const [corX, setCorX] = useState<string>("");
  const [corY, setCorY] = useState<string>("");

  const [dashboardRunId, setDashboardRunId] = useState<string>("");
  const [dashCorX, setDashCorX] = useState<string>("");
  const [dashCorY, setDashCorY] = useState<string>("");
  const [dashQuery, setDashQuery] = useState<string>("");

  // ── Pasta de saída (File System Access API) ──────────────────────────────
  const [saveDir, setSaveDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [saveDirName, setSaveDirName] = useState<string>("");
  const [saveDirStatus, setSaveDirStatus] = useState<string | null>(null);
  const fsSupported = typeof window !== "undefined" && fsSupportedInBrowser();

  const timersRef = useRef<{ tick?: number; log?: number }>({});
  const startMsRef = useRef<number | null>(null);
  const remainingMsRef = useRef<number>(0);

  // Recuperar timers globais quando o componente monta
  useEffect(() => {
    console.log("=== [ExperimentsView MOUNT] Component mounted ===");
    console.log("[ExperimentsView] Initial runStatus:", runStatus);
    console.log("[ExperimentsView] Initial runId:", runId);
    console.log("[ExperimentsView] Initial runRemainingMs:", runRemainingMs);
    
    if (typeof window !== "undefined") {
      const globalTimers = (window as any).__netopsTimers;
      console.log("[ExperimentsView] Global timers found:", globalTimers);
      
      // Se há timers rodando mas o componente não os tem na ref
      if (globalTimers && (globalTimers.tick || globalTimers.log) && !timersRef.current.tick) {
        console.log("[ExperimentsView] ✅ Detected active timers from previous mount");
        
        // IMPORTANTE: Manter os timers rodando (não parar)
        // Apenas copiar as referências para nossa ref local
        timersRef.current = globalTimers;
        
        console.log("[ExperimentsView] ✅ Timers reconnected to current component instance");
      } else if (!globalTimers) {
        console.log("[ExperimentsView] ⚠️ No global timers found");
      } else if (timersRef.current.tick) {
        console.log("[ExperimentsView] ℹ️ Timers already in local ref");
      }
    }
  }, [runStatus, runId, runRemainingMs]);
  
  // Carregar run state do backend ao montar o componente (PRIORITÁRIO)
  useEffect(() => {
    const loadRunState = async () => {
      console.log("[ExperimentsView] 🔄 Loading run state from backend...");
      const state = await loadRunStateFromBackend();
      if (state && Object.keys(state).length > 0) {
        console.log("[ExperimentsView] ✅ Loaded run state from backend:", state);
        if (state.runStatus) setRunStatus(state.runStatus);
        if (state.runId) {
          setRunId(state.runId);
          runIdRef.current = state.runId; // Sincronizar ref
        }
        if (state.runStartMs !== undefined) {
          setRunStartMs(state.runStartMs);
          startMsRef.current = state.runStartMs; // Sincronizar ref
        }
        if (state.runRemainingMs !== undefined) {
          setRunRemainingMs(state.runRemainingMs);
          remainingMsRef.current = state.runRemainingMs; // Sincronizar ref
        }
        if (state.currentRepeat !== undefined) setCurrentRepeat(state.currentRepeat);
        if (state.totalRepeats !== undefined) setTotalRepeats(state.totalRepeats);
        if (state.logs) setLogs(state.logs);
        if (state.annotations) setAnnotations(state.annotations);
      } else {
        console.log("[ExperimentsView] ℹ️ No saved run state found");
      }
    };
    loadRunState();
  }, []);
  
  // Atualizar a UI periodicamente lendo do backend (SEMPRE ativo)
  useEffect(() => {
    console.log("[ExperimentsView] Starting sync interval...");
    const syncInterval = window.setInterval(async () => {
      if (typeof window !== "undefined") {
        try {
          const state = await loadRunStateFromBackend();
          
          if (state && Object.keys(state).length > 0) {
            // Log da sincronização
            if (state.runStatus === "running") {
              console.log("[ExperimentsView] SYNC: status=", state.runStatus, "remaining=", state.runRemainingMs, "ms");
            }
            
            // Atualizar todos os estados E refs se mudaram
            if (state.runStatus && state.runStatus !== runStatus) {
              console.log("[ExperimentsView] ✅ Syncing runStatus:", runStatus, "→", state.runStatus);
              setRunStatus(state.runStatus);
            }
            if (state.runId && state.runId !== runId) {
              setRunId(state.runId);
              runIdRef.current = state.runId;
            }
            if (state.runStartMs !== undefined && state.runStartMs !== runStartMs) {
              setRunStartMs(state.runStartMs);
              startMsRef.current = state.runStartMs;
            }
            if (state.runRemainingMs !== undefined && state.runRemainingMs !== runRemainingMs) {
              setRunRemainingMs(state.runRemainingMs);
              remainingMsRef.current = state.runRemainingMs;
            }
            if (state.logs && JSON.stringify(state.logs) !== JSON.stringify(logs)) {
              console.log("[ExperimentsView] ✅ Syncing logs:", logs.length, "→", state.logs.length);
              setLogs(state.logs);
            }
            if (state.currentRepeat && state.currentRepeat !== currentRepeat) {
              setCurrentRepeat(state.currentRepeat);
            }
            if (state.totalRepeats && state.totalRepeats !== totalRepeats) {
              setTotalRepeats(state.totalRepeats);
            }
          }
        } catch (e) {
          console.error("[ExperimentsView] ❌ Failed to sync from backend:", e);
        }
      }
    }, 1000); // Sincroniza a cada 1 segundo (reduzido de 500ms para evitar overhead)
    
    return () => {
      console.log("[ExperimentsView] Stopping sync interval");
      window.clearInterval(syncInterval);
    };
  }, [runStatus, runRemainingMs, logs, currentRepeat, totalRepeats, runId, runStartMs]);

  // Salvar estado de execução sempre que mudar (usando backend - sistema de arquivos)
  // Com debounce para evitar requisições excessivas
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const runState = {
        runStatus,
        runId,
        runStartMs,
        runRemainingMs,
        currentRepeat,
        totalRepeats,
        logs: logs.slice(-100), // Salvar apenas os últimos 100 logs para não ficar muito grande
        annotations,
      };
      
      // Salvar no backend (confiável)
      saveRunStateToBackend(runState);
      
      console.log("[ExperimentsView] Run state saved to backend:", runStatus, "rep", currentRepeat, "/", totalRepeats);
    }, 300); // Debounce de 300ms
    
    return () => clearTimeout(timeoutId);
  }, [runStatus, runId, runStartMs, runRemainingMs, currentRepeat, totalRepeats, logs, annotations]);

  const runIdRef = useRef<string | null>(null);
  const importFileRef = useRef<HTMLInputElement | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const runMetaRef = useRef<{
    seed: number;
    metricKeys: string[];
    templateId: string | null;
    batch: RunRecord["batch"];
    topology: TopologySnapshotSummary | null;
    configSnapshot: ManualExperimentConfig;
  } | null>(null);

  const batchQueueRef = useRef<
    Array<{ id: string; seed: number; config: ManualExperimentConfig; metricKeys: string[]; templateId: string | null; batch: RunRecord["batch"]; topology: TopologySnapshotSummary | null }>
  >([]);

  const beginNextBatchIfAnyRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Carregar histórico do backend (fonte de verdade)
    readRunHistoryFromBackend().then((records) => {
      if (records.length > 0) {
        console.log("[ExperimentsView] ✅ Loaded", records.length, "experiments from backend");
        setHistory(records);
      } else {
        // Fallback: tentar localStorage legado
        const legacy = readRunHistory();
        if (legacy.length > 0) {
          console.log("[ExperimentsView] ℹ️ Migrating", legacy.length, "experiments from localStorage to backend");
          setHistory(legacy);
          // Migrar para o backend
          fetch(`${API_BASE}/experiment/history`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(legacy),
          }).catch(() => {});
        }
      }
    });
  }, []);

  useEffect(() => {
    try {
      const ls = safeLocalStorage();
      const raw = ls?.getItem("netops.experiments.dashboard.runId");
      if (typeof raw === "string" && raw.trim()) setDashboardRunId(raw.trim());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!dashboardRunId && history.length > 0) setDashboardRunId(history[0]!.id);
  }, [dashboardRunId, history]);

  // ── Restaurar pasta de saída salva no IndexedDB ──────────────────────────
  useEffect(() => {
    if (!fsSupported) return;
    void (async () => {
      try {
        const handle = await loadDirHandle();
        if (!handle) return;
        // Solicitar permissão silenciosamente; se o user precisar interagir
        // ele verá o prompt do browser automaticamente.
        const granted = await requestPermission(handle);
        if (granted) {
          setSaveDir(handle);
          setSaveDirName(handle.name);
          // Ler experimentos já salvos na pasta e mesclar ao histórico
          type SavedRecord = RunRecord & { __netopsRun?: boolean };
          const isRunRecord = (v: unknown): v is SavedRecord => {
            return (
              typeof v === "object" &&
              v !== null &&
              typeof (v as Record<string, unknown>).id === "string" &&
              typeof (v as Record<string, unknown>).startedAt === "string"
            );
          };
          const saved = await readJsonFilesFromDir<SavedRecord>(handle, isRunRecord);
          if (saved.length > 0) {
            setHistory((prev) => {
              const ids = new Set(prev.map((r) => r.id));
              const novelRuns = saved.filter((r) => !ids.has(r.id));
              if (novelRuns.length === 0) return prev;
              const next = [...novelRuns, ...prev].sort(
                (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
              );
              writeRunHistory(next);
              return next;
            });
          }
        }
      } catch {
        // pasta não mais acessível — ignorar silenciosamente
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsSupported]);

  const allSpecsByKey = useMemo(() => {
    const m = new Map<string, MetricSpec>();
    for (const layer of L0_L7) for (const s of getLayerMetrics(layer)) m.set(s.key, s);
    return m;
  }, []);

  const resolveSpecs = useCallback(
    (keys: string[]) => keys.map((k) => allSpecsByKey.get(k)).filter(Boolean) as MetricSpec[],
    [allSpecsByKey],
  );

  // ── Escolher / revogar pasta de saída ────────────────────────────────────
  const chooseSaveDir = useCallback(async () => {
    if (!fsSupported) return;
    try {
      const handle: FileSystemDirectoryHandle = await (window as unknown as { showDirectoryPicker: (o: unknown) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" });
      await persistDirHandle(handle);
      setSaveDir(handle);
      setSaveDirName(handle.name);
      setSaveDirStatus(`✔ Pasta definida: ${handle.name}`);
      setTimeout(() => setSaveDirStatus(null), 4000);

      // Carregar experimentos já existentes na pasta escolhida
      type SavedRecord = RunRecord & { __netopsRun?: boolean };
      const isRunRecord = (v: unknown): v is SavedRecord =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as Record<string, unknown>).id === "string" &&
        typeof (v as Record<string, unknown>).startedAt === "string";
      const saved = await readJsonFilesFromDir<SavedRecord>(handle, isRunRecord);
      if (saved.length > 0) {
        setHistory((prev) => {
          const ids = new Set(prev.map((r) => r.id));
          const novel = saved.filter((r) => !ids.has(r.id));
          if (novel.length === 0) return prev;
          const next = [...novel, ...prev].sort(
            (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
          );
          writeRunHistory(next);
          return next;
        });
      }
    } catch (err) {
      if ((err as DOMException)?.name !== "AbortError") {
        setSaveDirStatus("Erro ao escolher pasta.");
        setTimeout(() => setSaveDirStatus(null), 4000);
      }
    }
  }, [fsSupported]);

  const removeSaveDir = useCallback(async () => {
    await clearDirHandle();
    setSaveDir(null);
    setSaveDirName("");
    setSaveDirStatus("Pasta removida.");
    setTimeout(() => setSaveDirStatus(null), 3000);
  }, []);

  const stopTimers = useCallback(() => {
    if (timersRef.current.tick) window.clearInterval(timersRef.current.tick);
    if (timersRef.current.log) window.clearInterval(timersRef.current.log);
    timersRef.current = {};
    // Limpar timers globais
    if (typeof window !== "undefined") {
      delete (window as any).__netopsTimers;
      console.log("[ExperimentsView] Cleared global timers");
    }
  }, []);

  // NÃO parar os timers quando o componente desmonta - experimentos devem continuar rodando
  // Os timers só devem ser parados explicitamente (pause, abort, reset)
  // useEffect(() => {
  //   return () => stopTimers();
  // }, [stopTimers]);

  const finalizeRun = useCallback(
    ({ status }: { status: "Sucesso" | "Falha" }) => {
      try {
        const id = runIdRef.current ?? runId ?? makeRunId();
        const startedAtMs = startMsRef.current ?? Date.now();
        const startedAt = new Date(startedAtMs).toISOString();
        const endedAt = nowIso();

        const meta = runMetaRef.current;
        const cfg = meta?.configSnapshot ?? config;
        const metricKeys = meta?.metricKeys ?? Array.from(selectedMetricKeys);
        const seed = meta?.seed ?? hashSeed(id);
        const templateId = meta?.templateId ?? activeTemplateId;
        const batch = meta?.batch ?? null;
        const topology = meta?.topology ?? null;

        const samplingMs = clamp(cfg.general.samplingMs, 80, 5000);
        const durationMs = Math.max(1, Math.round(cfg.general.durationS * 1000));
        // Generate the full natural resolution — LTTB is applied when persisting
        // to localStorage so the chart preview is always visually accurate.
        const points = Math.max(12, Math.round(durationMs / samplingMs));

        const specs = resolveSpecs(metricKeys);
        const seriesMap = simulateSeriesMap({ specs, points, seed });
        const controlPlane = simulateControlPlaneLog({ startedAtMs, durationMs, samplingMs, seed });

        // Quick insight: compare current metric mean against historical template mean.
        let insight: string | undefined;
        const primaryKey = metricKeys.includes("app_latency_ms_p95")
          ? "app_latency_ms_p95"
          : metricKeys.includes("app_latency_ms")
            ? "app_latency_ms"
            : metricKeys[0];
        if (templateId && primaryKey && seriesMap[primaryKey]) {
          const currentMean = mean(seriesMap[primaryKey] ?? []);
          const peers = readRunHistory().filter((r) => r.status === "Sucesso" && r.templateId === templateId && r.seriesMap && r.seriesMap[primaryKey]);
          const peerMeans = peers.map((r) => mean(r.seriesMap?.[primaryKey] ?? []));
          if (peerMeans.length >= 2) {
            const hist = mean(peerMeans);
            if (Math.abs(hist) > 1e-9) {
              const pct = ((currentMean - hist) / hist) * 100;
              const dir = pct >= 0 ? "maior" : "menor";
              insight = `Insight rápido: ${primaryKey} médio nesta execução foi ${Math.abs(pct).toFixed(1)}% ${dir} que a média histórica do template.`;
            }
          }
        }

        const record: RunRecord = {
          id,
          seed,
          startedAt,
          endedAt,
          status,
          config: cfg,
          templateId,
          metricKeys,
          seriesMap,
          annotations: annotations.slice(),
          controlPlane,
          topology,
          insight,
          batch,
        };

        // ✅ Salvar no backend IMEDIATAMENTE (fonte de verdade no disco)
        appendRunRecordToBackend(record);
        
        const nextHistory = [record, ...history];
        writeRunHistory(nextHistory);
        setHistory(nextHistory);

        // ── Auto-save para pasta de saída escolhida pelo usuário ─────────
        ;(async () => {
          try {
            const dir = saveDir;
            if (!dir) return;
            const granted = await requestPermission(dir);
            if (!granted) return;
            await writeJsonToDir(dir, `experimento_${record.id}.json`, record);
          } catch {
            // Falha silenciosa
          }
        })();
        if (insight) setLogs((p) => [...p, `[${nowIso()}] ${insight}`].slice(-400));

        // ── Sync to back-end (fire-and-forget) ──────────────────────────────
        ;(async () => {
          try {
            // Ensure a topology exists in the backend
            let topoId: string | null = null;
            try {
              const topos = await topologyApi.list();
              topoId = topos[0]?.id ?? null;
              if (!topoId) {
                const created = await topologyApi.create({
                  name: "Auto (Frontend)",
                  nodes: [],
                  links: [],
                });
                topoId = created.id;
              }
            } catch { /* backend offline – skip */ }

            if (!topoId) return;

            // Create experiment
            const exp = await experimentApi.create({
              name: cfg.general.name || id,
              topology_id: topoId,
              description: cfg.general.scientificDescription || undefined,
              parameters: {
                traffic: cfg.traffic,
                sampling_ms: cfg.general.samplingMs,
                duration_s: cfg.general.durationS,
                template_id: templateId ?? undefined,
              },
            });

            // Start a synthetic run (snapshot) on the backend
            await experimentApi.startRun(exp.id, "synthetic");

            // Push simulated metric samples to backend
            const samples: MetricSample[] = [];
            for (const [k, series] of Object.entries(seriesMap)) {
              for (let i = 0; i < series.length; i++) {
                samples.push({
                  timestamp: new Date(startedAtMs + i * samplingMs).toISOString(),
                  node: cfg.traffic.srcHostId || "probe",
                  layer: "network",
                  metric: k,
                  value: series[i] ?? 0,
                  labels: { experiment_id: exp.id, run_id: id, version: "frontend" },
                });
              }
            }
            // Send in batches of 100
            for (let i = 0; i < samples.length; i += 100) {
              await metricsApi.ingestSamples(samples.slice(i, i + 100));
            }
          } catch {
            // Best-effort: backend sync failures are silently ignored
          }
        })();
      } catch (err) {
        // Defensive: don't let record-saving errors crash the React tree
        console.error("[finalizeRun] unexpected error:", err);
      }
    },
    [activeTemplateId, annotations, config, history, resolveSpecs, runId, saveDir, selectedMetricKeys],
  );

  const installTimers = useCallback(
    ({ id, durationMs }: { id: string; durationMs: number }) => {
      stopTimers();

      const meta = runMetaRef.current;
      const cfg = meta?.configSnapshot ?? config;
      const metricKeys = meta?.metricKeys ?? Array.from(selectedMetricKeys);
      const samplingMs = clamp(cfg.general.samplingMs, 80, 5000);

      timersRef.current.tick = window.setInterval(() => {
        // Ler estado atual
        let currentRemaining = remainingMsRef.current;
        
        const next = Math.max(0, currentRemaining - 250);
        remainingMsRef.current = next;
        
        // Atualizar React state (o useEffect de save cuida de salvar no backend)
        setRunRemainingMs(next);
        
        if (next === 0) {
          stopTimers();
          setRunStatus("success");
          setLogs((p) => [...p, `[${nowIso()}] RUN ${id} · concluída (sucesso)`].slice(-400));
          finalizeRun({ status: "Sucesso" });

          // Check for repeats first, then batches
          setTimeout(() => {
            const didStartRepeat = beginNextRepeatIfAnyRef.current();
            if (!didStartRepeat && batchQueueRef.current.length > 0) {
              beginNextBatchIfAnyRef.current();
            }
          }, 350);
        }
      }, 250);

      timersRef.current.log = window.setInterval(() => {
        const t = durationMs - remainingMsRef.current;
        const sel = metricKeys;
        const sampleKeys = sel.slice(0, 6);
        const parts = sampleKeys.map((k) => `${k}=${(Math.random() * 100).toFixed(2)}`);
        const line = `[${nowIso()}] t+${Math.max(0, Math.round(t / 1000))}s · ${parts.join(" · ")}${sel.length > sampleKeys.length ? ` · +${sel.length - sampleKeys.length} métricas` : ""}`;
        
        // Atualizar React state (o useEffect de save cuida de salvar no backend)
        setLogs((prev) => [...prev, line].slice(-400));
      }, samplingMs);

      // Salvar timers globalmente para que persistam quando o componente desmontar
      if (typeof window !== "undefined") {
        (window as any).__netopsTimers = timersRef.current;
        console.log("[ExperimentsView] Saved timers to window:", timersRef.current);
      }
    },
    [config, finalizeRun, selectedMetricKeys, stopTimers],
  );

  // Start the next repeat of the same experiment
  const beginNextRepeatIfAny = useCallback(() => {
    if (currentRepeat >= totalRepeats) return false;

    const meta = runMetaRef.current;
    if (!meta) return false;

    const nextRepeat = currentRepeat + 1;
    setCurrentRepeat(nextRepeat);

    // Start next run fresh with same config
    stopTimers();
    startMsRef.current = null;
    remainingMsRef.current = 0;
    runIdRef.current = null;
    setAnnotations([]);
    setEventLabel("");

    const newId = makeRunId();
    const cfg = meta.configSnapshot;
    const start = Date.now();
    const seed = hashSeed(newId) ^ start;
    const durationMs = Math.max(1, Math.round(cfg.general.durationS * 1000));

    runMetaRef.current = {
      seed,
      metricKeys: meta.metricKeys,
      templateId: meta.templateId,
      batch: meta.batch,
      topology: meta.topology,
      configSnapshot: cfg,
    };

    runIdRef.current = newId;
    startMsRef.current = start;
    remainingMsRef.current = durationMs;
    setRunStartMs(start);
    setRunRemainingMs(durationMs);
    setRunId(newId);
    setRunStatus("running");

    const repeatInfo = ` · repetição ${nextRepeat}/${totalRepeats}`;
    setLogs((prev) => [
      ...prev,
      `[${nowIso()}] RUN ${newId} · iniciar${meta.batch ? ` · lote ${meta.batch.index}/${meta.batch.total}` : ""}${repeatInfo}`,
      `[${nowIso()}] sampling=${cfg.general.samplingMs}ms · duration=${cfg.general.durationS}s`,
    ].slice(-400));

    installTimers({ id: newId, durationMs });
    return true;
  }, [currentRepeat, totalRepeats, stopTimers, installTimers]);

  const beginNextRepeatIfAnyRef = useRef(beginNextRepeatIfAny);
  useEffect(() => {
    beginNextRepeatIfAnyRef.current = beginNextRepeatIfAny;
  }, [beginNextRepeatIfAny]);

  const beginNextBatchIfAny = useCallback(() => {
    const next = batchQueueRef.current.shift();
    if (!next) return;

    // Start next run fresh.
    stopTimers();
    startMsRef.current = null;
    remainingMsRef.current = 0;
    runIdRef.current = null;
    runMetaRef.current = null;
    setAnnotations([]);
    setEventLabel("");

    // Apply run meta + start.
    runMetaRef.current = {
      seed: next.seed,
      metricKeys: next.metricKeys,
      templateId: next.templateId,
      batch: next.batch,
      topology: next.topology,
      configSnapshot: next.config,
    };
    setRunId(next.id);
    runIdRef.current = next.id;
    const start = Date.now();
    startMsRef.current = start;
    const durationMs = Math.max(1, Math.round(next.config.general.durationS * 1000));
    remainingMsRef.current = durationMs;
    setRunStartMs(start);
    setRunRemainingMs(durationMs);
    setRunStatus("running");
    setLogs([
      `[${nowIso()}] RUN ${next.id} · iniciar${next.batch ? ` · lote ${next.batch.index}/${next.batch.total} (${next.batch.start}+${(next.batch.index - 1) * next.batch.step}${next.batch.unit})` : ""}`,
      `[${nowIso()}] sampling=${next.config.general.samplingMs}ms · duration=${next.config.general.durationS}s`,
      `[${nowIso()}] metrics=${next.metricKeys.slice(0, 8).join(", ")}${next.metricKeys.length > 8 ? ` +${next.metricKeys.length - 8}` : ""}`,
    ]);

    installTimers({ id: next.id, durationMs });
  }, [installTimers, stopTimers]);

  useEffect(() => {
    beginNextBatchIfAnyRef.current = beginNextBatchIfAny;
  }, [beginNextBatchIfAny]);

  const startRun = useCallback(() => {
    setValidation(null);
    if (selectedMetricKeys.size === 0) {
      setValidation("Selecione ao menos 1 métrica de coleta (L0–L7) para iniciar a Run.");
      return;
    }

    // Resume
    if (runStatus === "paused") {
      setRunStatus("running");
    }

    const id = runIdRef.current ?? runId ?? makeRunId();
    const durationMs = Math.max(1, Math.round(config.general.durationS * 1000));

    // Initialize a new run if not started.
    if (!startMsRef.current) {
      const start = Date.now();
      const seed = hashSeed(id) ^ start;
      const metricKeys = Array.from(selectedMetricKeys).slice().sort();
      const topology = readLatestTopologySummary();
      const baseCfg: ManualExperimentConfig = JSON.parse(JSON.stringify(config)) as ManualExperimentConfig;

      runMetaRef.current = {
        seed,
        metricKeys,
        templateId: activeTemplateId,
        batch: null,
        topology,
        configSnapshot: baseCfg,
      };

      // Build batch queue when enabled.
      if (batchEnabled) {
        const total = clamp(Math.round(batchCount), 2, 50);
        const startRate = baseCfg.traffic.rateValue;
        const step = batchStep;
        batchQueueRef.current = [];
        for (let i = 1; i <= total; i++) {
          const rid = i === 1 ? id : makeRunId();
          const cfg: ManualExperimentConfig = JSON.parse(JSON.stringify(baseCfg)) as ManualExperimentConfig;
          cfg.traffic.rateValue = startRate + (i - 1) * step;
          batchQueueRef.current.push({
            id: rid,
            seed: seed ^ hashSeed(rid) ^ i,
            config: cfg,
            metricKeys,
            templateId: activeTemplateId,
            batch: { variable: "traffic.rateValue", index: i, total, start: startRate, step, unit: cfg.traffic.rateUnit },
            topology,
          });
        }

        // Pop the first element and proceed as a normal run.
        const first = batchQueueRef.current.shift();
        if (first) {
          runMetaRef.current.batch = first.batch;
          runMetaRef.current.seed = first.seed;
          runMetaRef.current.configSnapshot = first.config;
        }
      } else {
        batchQueueRef.current = [];
      }

      // Initialize repeat tracking
      const repeatCount = Math.max(1, config.general.repeatCount ?? 1);
      setTotalRepeats(repeatCount);
      setCurrentRepeat(1);

      startMsRef.current = start;
      remainingMsRef.current = durationMs;
      runIdRef.current = id;
      setRunStartMs(start);
      setRunRemainingMs(durationMs);
      setAnnotations([]);
      setEventLabel("");
      const repeatInfo = repeatCount > 1 ? ` · repetição 1/${repeatCount}` : "";
      setLogs([
        `[${nowIso()}] RUN ${id} · iniciar${runMetaRef.current.batch ? ` · lote ${runMetaRef.current.batch.index}/${runMetaRef.current.batch.total} (${runMetaRef.current.batch.start}+${(runMetaRef.current.batch.index - 1) * runMetaRef.current.batch.step}${config.traffic.rateUnit})` : ""}${repeatInfo}`,
        `[${nowIso()}] sampling=${config.general.samplingMs}ms · duration=${config.general.durationS}s`,
        `[${nowIso()}] metrics=${metricKeys.slice(0, 8).join(", ")}${metricKeys.length > 8 ? ` +${metricKeys.length - 8}` : ""}`,
      ]);
    }

    setRunId(id);
    setRunStatus("running");

    installTimers({ id, durationMs });
  }, [activeTemplateId, batchCount, batchEnabled, batchStep, config, installTimers, runId, runStatus, selectedMetricKeys]);

  const pauseRun = useCallback(() => {
    if (runStatus !== "running") return;
    stopTimers();
    setRunStatus("paused");
    if (runId) setLogs((p) => [...p, `[${nowIso()}] RUN ${runId} · pausada`].slice(-400));
  }, [runId, runStatus, stopTimers]);

  const abortRun = useCallback(() => {
    if (runStatus === "idle" || runStatus === "success" || runStatus === "failed") return;
    stopTimers();
    setRunStatus("failed");
    const id = runId ?? makeRunId();
    setRunId(id);
    runIdRef.current = id;
    setLogs((p) => [...p, `[${nowIso()}] RUN ${id} · abortada (falha)`].slice(-400));

    finalizeRun({ status: "Falha" });
    batchQueueRef.current = [];
  }, [finalizeRun, runId, runStatus, stopTimers]);

  const resetRunUi = useCallback(() => {
    stopTimers();
    setRunStatus("idle");
    setRunId(null);
    setRunStartMs(null);
    setRunRemainingMs(0);
    setLogs([]);
    setAnnotations([]);
    setEventLabel("");
    setCurrentRepeat(1);
    setTotalRepeats(1);
    startMsRef.current = null;
    remainingMsRef.current = 0;
    runIdRef.current = null;
    runMetaRef.current = null;
    batchQueueRef.current = [];
    
    // Limpar estado salvo
    try {
      localStorage.removeItem("netops.experiments.runState");
      console.log("[ExperimentsView] Run state cleared");
    } catch (e) {
      console.error("Failed to clear run state", e);
    }
  }, [stopTimers]);

  const inspectRun = useCallback(
    (r: RunRecord) => {
      try {
        const ls = safeLocalStorage();
        if (ls) {
          ls.setItem("netops.experiments.dashboard.runId", r.id);
        }
      } catch {
        // ignore
      }
      setDashboardRunId(r.id);
      setTab("dashboard");
    },
    [],
  );

  // ── Bundle export: syncs the local run record to backend then downloads ──
  const exportBundle = useCallback(
    async (r: RunRecord) => {
      // Best-effort: try to fetch the backend bundle (has real metrics) first.
      try {
        const topos = await topologyApi.list();
        const topoId = topos[0]?.id ?? null;
        if (topoId) {
          // Find matching backend experiment by name+id heuristic
          const exps = await experimentApi.list();
          const match = exps.find((e) => e.name === (r.config.general.name || r.id));
          if (match) {
            const bundle = await experimentApi.exportBundle(match.id);
            downloadTextFile({
              filename: `bundle_${r.id}.json`,
              content: JSON.stringify(bundle, null, 2),
              mime: "application/json;charset=utf-8",
            });
            return;
          }
        }
      } catch {
        // backend unreachable – fall through to local bundle
      }

      // Fallback: build a local-only bundle from localStorage record
      const localBundle = {
        version: 1,
        exported_at: new Date().toISOString(),
        experiment: {
          id: r.id,
          name: r.config.general.name || r.id,
          topology_id: "",
          description: r.config.general.scientificDescription || "",
          parameters: {
            traffic: r.config.traffic,
            duration_s: r.config.general.durationS,
            sampling_ms: r.config.general.samplingMs,
            template_id: r.templateId ?? null,
          },
        },
        runs: [
          {
            id: r.id,
            experiment_id: r.id,
            topology_id: "",
            status: r.status === "Sucesso" ? "COMPLETED" : "FAILED",
            started_at: r.startedAt,
            ended_at: r.endedAt,
            parameters: { seed: r.seed, batch: r.batch ?? null },
            logs: [],
          },
        ],
        run_metrics: {} as Record<string, unknown[]>,
        // Embed the series data so the recipient can recreate charts
        local_series_map: r.seriesMap ?? {},
        local_annotations: r.annotations ?? [],
        local_control_plane: r.controlPlane ?? [],
        local_topology: r.topology ?? null,
        local_insight: r.insight ?? "",
        local_metric_keys: r.metricKeys,
      };
      downloadTextFile({
        filename: `bundle_${r.id}.json`,
        content: JSON.stringify(localBundle, null, 2),
        mime: "application/json;charset=utf-8",
      });
    },
    [],
  );

  // ── Bundle import: reads a .json file and restores run to localStorage + backend ──
  const importBundle = useCallback(
    async (file: File) => {
      setImportStatus("Lendo arquivo…");
      try {
        const text = await file.text();
        const bundle = JSON.parse(text) as Record<string, unknown>;

        // Restore to localStorage: reconstruct RunRecord(s)
        const expData = bundle.experiment as Record<string, unknown> | undefined;
        const runsData = (bundle.runs as Record<string, unknown>[] | undefined) ?? [];
        let imported = 0;
        const nextHistory = [...readRunHistory()];

        for (const runData of runsData) {
          const runId = String(runData.id ?? "");
          if (!runId || nextHistory.some((h) => h.id === runId)) continue;

          const params = (runData.parameters ?? {}) as Record<string, unknown>;
          const cfg: ManualExperimentConfig = {
            general: {
              name: String(expData?.name ?? bundle.local_series_map ? expData?.name ?? runId : runId),
              scientificDescription: String(expData?.description ?? ""),
              durationS: typeof params.duration_s === "number" ? params.duration_s : 120,
              samplingMs: typeof params.sampling_ms === "number" ? params.sampling_ms : 250,
            },
            traffic: (expData?.parameters as Record<string, unknown> | undefined)?.traffic as ManualExperimentConfig["traffic"] ?? {
              srcHostId: "Host-A",
              dstHostId: "Host-D",
              type: "TCP",
              rateValue: 300,
              rateUnit: "Mbps",
            },
            telemetry: { metricKeys: (bundle.local_metric_keys as string[]) ?? [] },
            scripts: { pre: "", post: "" },
          };

          const record: RunRecord = {
            id: runId,
            seed: typeof params.seed === "number" ? params.seed : hashSeed(runId),
            startedAt: String(runData.started_at ?? new Date().toISOString()),
            endedAt: String(runData.ended_at ?? new Date().toISOString()),
            status: runData.status === "FAILED" ? "Falha" : "Sucesso",
            config: cfg,
            templateId: (params.template_id as string | null | undefined) ?? null,
            metricKeys: (bundle.local_metric_keys as string[] | undefined) ?? [],
            seriesMap: (bundle.local_series_map as SeriesMap | undefined) ?? undefined,
            annotations: (bundle.local_annotations as Annotation[] | undefined) ?? [],
            controlPlane: (bundle.local_control_plane as ControlPlaneEvent[] | undefined) ?? [],
            topology: (bundle.local_topology as TopologySnapshotSummary | null | undefined) ?? null,
            insight: String(bundle.local_insight ?? "") || undefined,
            batch: (params.batch as RunRecord["batch"]) ?? null,
          };
          nextHistory.unshift(record);
          imported++;
        }

        if (imported > 0) {
          writeRunHistory(nextHistory);
          setHistory(nextHistory);
          setImportStatus(`✔ ${imported} run(s) importada(s) com sucesso.`);
        } else {
          setImportStatus("Nenhuma run nova encontrada no bundle.");
        }

        // Best-effort: push to backend
        try {
          await experimentApi.importBundle(bundle as unknown as ExperimentBundle);
        } catch {
          // backend unreachable or reject — local import already succeeded
        }
      } catch (err) {
        setImportStatus(`Erro ao importar: ${err instanceof Error ? err.message : String(err)}`);
      }
      setTimeout(() => setImportStatus(null), 5000);
    },
    [],
  );

  const exportRunDataset = useCallback((r: RunRecord, format: "json" | "csv") => {
    const samplingMs = clamp(r.config.general.samplingMs, 80, 5000);
    const startedAtMs = Date.parse(r.startedAt);
    const metricKeys = (r.metricKeys ?? r.config.telemetry.metricKeys ?? []).slice();
    if (!Number.isFinite(startedAtMs) || metricKeys.length === 0) return;

    const specs = resolveSpecs(metricKeys);
    // Full resolution for data exports — no downsampling.
    const points = Math.max(12, Math.round((r.config.general.durationS * 1000) / samplingMs));
    const seriesMap = r.seriesMap ?? simulateSeriesMap({ specs, points, seed: r.seed ?? hashSeed(r.id) });
    const rows = buildDatasetRows({ seriesMap, metricKeys, startedAtMs, samplingMs });

    if (format === "json") {
      downloadTextFile({
        filename: `dataset_${r.id}.json`,
        content: JSON.stringify({ runId: r.id, startedAt: r.startedAt, samplingMs, rows }, null, 2),
        mime: "application/json;charset=utf-8",
      });
      return;
    }

    const csv = datasetToCsv(rows, metricKeys);
    downloadTextFile({ filename: `dataset_${r.id}.csv`, content: csv, mime: "text/csv;charset=utf-8" });
  }, [resolveSpecs]);

  const exportControlPlaneLog = useCallback((r: RunRecord, format: "json" | "txt") => {
    const startedAtMs = Date.parse(r.startedAt);
    if (!Number.isFinite(startedAtMs)) return;
    const samplingMs = clamp(r.config.general.samplingMs, 80, 5000);
    const durationMs = Math.max(1, Math.round(r.config.general.durationS * 1000));
    const log = r.controlPlane ?? simulateControlPlaneLog({ startedAtMs, durationMs, samplingMs, seed: r.seed ?? hashSeed(r.id) });

    if (format === "json") {
      downloadTextFile({
        filename: `control_plane_${r.id}.json`,
        content: JSON.stringify({ runId: r.id, events: log }, null, 2),
        mime: "application/json;charset=utf-8",
      });
      return;
    }

    const txt = log.map((e) => `[${e.ts}] ${e.datapathId} ${e.type} · ${e.summary}`).join("\n");
    downloadTextFile({ filename: `control_plane_${r.id}.txt`, content: txt, mime: "text/plain;charset=utf-8" });
  }, []);

  const exportRunPdf = useCallback((r: RunRecord) => {
    const samplingMs = clamp(r.config.general.samplingMs, 80, 5000);
    const startedAtMs = Date.parse(r.startedAt);
    if (!Number.isFinite(startedAtMs)) return;

    const metricKeys = (r.metricKeys ?? r.config.telemetry.metricKeys ?? []).slice();
    const specs = resolveSpecs(metricKeys);
    // Full resolution for statistical accuracy (mean, p95, CI etc.)
    const points = Math.max(12, Math.round((r.config.general.durationS * 1000) / samplingMs));
    const seriesMap = r.seriesMap ?? simulateSeriesMap({ specs, points, seed: r.seed ?? hashSeed(r.id) });

    const topK = metricKeys.slice(0, 4);
    const rows = topK
      .map((k) => {
        const arr = seriesMap[k] ?? [];
        const ci = confidenceInterval95(arr);
        return {
          key: k,
          mean: mean(arr),
          median: median(arr),
          std: stddev(arr),
          p95: p95(arr),
          p99: p99(arr),
          ciLow: ci.low,
          ciHigh: ci.high,
        };
      })
      .map(
        (s) =>
          `<tr><td style="font-family:monospace">${s.key}</td><td>${s.mean.toFixed(3)}</td><td>${s.median.toFixed(3)}</td><td>${s.std.toFixed(3)}</td><td>${s.p95.toFixed(3)}</td><td>${s.p99.toFixed(3)}</td><td>${s.ciLow.toFixed(3)} – ${s.ciHigh.toFixed(3)}</td></tr>`,
      )
      .join("");

    const topo = r.topology;
    const topoLine = topo
      ? `${new Date(topo.capturedAt).toLocaleString()}${topo.name ? ` · ${topo.name}` : ""}${topo.mode ? ` · ${topo.mode}` : ""}${typeof topo.nodes === "number" ? ` · nodes=${topo.nodes}` : ""}${typeof topo.edges === "number" ? ` · edges=${topo.edges}` : ""}`
      : "—";

    const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Relatório ${escapeHtml(r.id)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:24px; color:#111;}
  h1{font-size:18px; margin:0 0 8px 0;}
  .muted{color:#444; font-size:12px;}
  .grid{display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px;}
  table{border-collapse:collapse; width:100%; font-size:12px; margin-top:12px;}
  th,td{border:1px solid #ddd; padding:6px 8px; text-align:left;}
  th{background:#f6f6f6;}
  code{font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px;}
</style>
</head>
<body>
  <h1>Relatório de Execução (Run <code>${escapeHtml(r.id)}</code>)</h1>
  <div class="muted">${escapeHtml(new Date(r.startedAt).toLocaleString())} → ${escapeHtml(new Date(r.endedAt).toLocaleString())} · sampling=${samplingMs}ms · duration=${r.config.general.durationS}s · status=${escapeHtml(r.status)}</div>
  <div class="grid">
    <div>
      <div class="muted"><b>Experimento</b></div>
      <div><b>${escapeHtml(r.config.general.name)}</b></div>
      <div class="muted">${escapeHtml(r.config.general.scientificDescription || "—")}</div>
      <div style="margin-top:8px" class="muted"><b>Tráfego</b></div>
      <div><code>${escapeHtml(r.config.traffic.srcHostId)}</code> → <code>${escapeHtml(r.config.traffic.dstHostId)}</code> · <code>${escapeHtml(r.config.traffic.type)}</code> · <code>${escapeHtml(String(r.config.traffic.rateValue))}${escapeHtml(r.config.traffic.rateUnit)}</code></div>
      <div style="margin-top:8px" class="muted"><b>Topologia (snapshot)</b></div>
      <div><code>${escapeHtml(topoLine)}</code></div>
    </div>
    <div>
      <div class="muted"><b>Métricas selecionadas</b></div>
      <div><code>${escapeHtml(metricKeys.join(", ") || "—")}</code></div>
      ${r.insight ? `<div style="margin-top:8px" class="muted"><b>Insight rápido</b></div><div>${escapeHtml(r.insight)}</div>` : ""}
    </div>
  </div>

  <table>
    <thead><tr>
      <th>Métrica</th><th>Média</th><th>Mediana</th><th>Desvio Padrão</th><th>p95</th><th>p99</th><th>IC95% (média)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <script>
    setTimeout(() => { try { window.print(); } catch {} }, 60);
  </script>
</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [resolveSpecs]);

  const selectedRunsForCompare = useMemo(() => {
    const ids = Array.from(selectedHistoryIds);
    const map = new Map(history.map((r) => [r.id, r] as const));
    return ids.map((id) => map.get(id)).filter(Boolean) as RunRecord[];
  }, [history, selectedHistoryIds]);

  const commonMetricKeys = useMemo(() => {
    if (selectedRunsForCompare.length < 2) return [] as string[];
    const sets = selectedRunsForCompare.map((r) => new Set((r.metricKeys ?? r.config.telemetry.metricKeys ?? []) as string[]));
    const base = Array.from(sets[0] ?? []);
    return base.filter((k) => sets.every((s) => s.has(k)));
  }, [selectedRunsForCompare]);

  useEffect(() => {
    if (!compareOpen) return;
    if (commonMetricKeys.length === 0) return;
    if (compareMetricKey && commonMetricKeys.includes(compareMetricKey)) return;
    setCompareMetricKey(commonMetricKeys[0] ?? "");
  }, [commonMetricKeys, compareMetricKey, compareOpen]);

  const compareSeries = useMemo(() => {
    if (!compareOpen || selectedRunsForCompare.length < 2 || !compareMetricKey) return null;
    const series = selectedRunsForCompare.map((r, idx) => {
      const values = r.seriesMap?.[compareMetricKey] ?? [];
      return {
        id: r.id,
        values,
        opacity: 0.9,
        strokeDasharray: idx === 0 ? undefined : idx === 1 ? "5 4" : "2 6",
      };
    });
    return series;
  }, [compareMetricKey, compareOpen, selectedRunsForCompare]);

  const compareOutliersById = useMemo(() => {
    if (!compareOutliers || !compareSeries) return undefined;
    const out: Record<string, number[]> = {};
    for (const s of compareSeries) out[s.id] = outlierIndicesZ(s.values, 3);
    return out;
  }, [compareOutliers, compareSeries]);

  const correlation = useMemo(() => {
    if (!compareOpen || selectedRunsForCompare.length === 0) return null;
    if (!corX || !corY || corX === corY) return null;
    const r0 = selectedRunsForCompare[0];
    const xs = r0.seriesMap?.[corX] ?? [];
    const ys = r0.seriesMap?.[corY] ?? [];
    if (xs.length < 2 || ys.length < 2) return null;
    return { r: pearsonR(xs, ys), xs, ys };
  }, [compareOpen, corX, corY, selectedRunsForCompare]);

  const dashboardRun = useMemo(() => {
    if (history.length === 0) return null;
    return history.find((h) => h.id === dashboardRunId) ?? history[0] ?? null;
  }, [dashboardRunId, history]);

  const dashboardSamplingMs = useMemo(() => {
    return clamp(dashboardRun?.config?.general?.samplingMs ?? 250, 80, 5000);
  }, [dashboardRun?.config?.general?.samplingMs]);

  const dashboardMetricKeys = useMemo(() => {
    if (!dashboardRun) return [] as string[];
    const keys = (dashboardRun.metricKeys ?? dashboardRun.config.telemetry.metricKeys ?? []).filter((k) => typeof k === "string");
    return Array.from(new Set(keys));
  }, [dashboardRun]);

  const dashboardSpecs = useMemo(() => resolveSpecs(dashboardMetricKeys), [dashboardMetricKeys, resolveSpecs]);

  const dashboardPoints = useMemo(() => {
    if (!dashboardRun) return 36;
    const durationMs = Math.max(1, Math.round(dashboardRun.config.general.durationS * 1000));
    // Full natural resolution — LTTB is applied per-series in dashboardSeriesMap.
    return Math.max(12, Math.round(durationMs / dashboardSamplingMs));
  }, [dashboardRun, dashboardSamplingMs]);

  const dashboardSeriesMap = useMemo(() => {
    if (!dashboardRun) return {} as SeriesMap;
    const raw: SeriesMap = dashboardRun.seriesMap
      ?? simulateSeriesMap({ specs: dashboardSpecs, points: dashboardPoints, seed: dashboardRun.seed ?? hashSeed(dashboardRun.id) });
    // LTTB: reduce each series to at most 1200 pts for chart performance while
    // preserving peaks and anomalies far better than uniform sub-sampling.
    return lttbSeriesMap(raw, /* totalByteBudget */ 1_200 * 8 * Object.keys(raw).length, {
      minPoints: 50,
      maxPoints: 1200,
    });
  }, [dashboardPoints, dashboardRun, dashboardSpecs]);

  const dashboardMarkers = useMemo(() => {
    if (!dashboardRun?.annotations?.length) return [] as Array<{ index: number; label?: string }>;
    return dashboardRun.annotations
      .slice(0, 120)
      .map((a) => ({ index: Math.max(0, Math.round(a.tMs / dashboardSamplingMs)), label: a.label }));
  }, [dashboardRun?.annotations, dashboardSamplingMs]);

  const filteredDashboardSpecs = useMemo(() => {
    const query = dashQuery.trim().toLowerCase();
    const base = dashboardSpecs;
    if (!query) return base;
    return base.filter((s) => s.name.toLowerCase().includes(query) || s.key.toLowerCase().includes(query));
  }, [dashQuery, dashboardSpecs]);

  const dashCorrelation = useMemo(() => {
    if (!dashCorX || !dashCorY || dashCorX === dashCorY) return null;
    const xs = dashboardSeriesMap[dashCorX] ?? [];
    const ys = dashboardSeriesMap[dashCorY] ?? [];
    if (xs.length < 2 || ys.length < 2) return null;
    return { r: pearsonR(xs, ys), xs, ys };
  }, [dashCorX, dashCorY, dashboardSeriesMap]);

  const dashboardStatRows = useMemo(() => {
    return filteredDashboardSpecs.map((spec) => {
      const arr = dashboardSeriesMap[spec.key] ?? [];
      const ci = confidenceInterval95(arr);
      return {
        key: spec.key,
        name: spec.name,
        layer: spec.layer,
        type: spec.type,
        unit: spec.unit ?? "—",
        n: ci.n,
        mean: mean(arr),
        median: median(arr),
        std: stddev(arr),
        var: variance(arr),
        p95: p95(arr),
        p99: p99(arr),
        ciLow: ci.low,
        ciHigh: ci.high,
        outliersZ3: outlierIndicesZ(arr, 3).length,
      };
    });
  }, [dashboardSeriesMap, filteredDashboardSpecs]);

  const exportExperimentDashboardJson = useCallback(() => {
    if (!dashboardRun) return;
    const payload = {
      exportedAt: new Date().toISOString(),
      run: {
        id: dashboardRun.id,
        startedAt: dashboardRun.startedAt,
        endedAt: dashboardRun.endedAt,
        status: dashboardRun.status,
        seed: dashboardRun.seed,
        name: dashboardRun.config.general.name,
        scientificDescription: dashboardRun.config.general.scientificDescription ?? "",
        durationS: dashboardRun.config.general.durationS,
        samplingMs: dashboardSamplingMs,
        insight: dashboardRun.insight ?? "",
      },
      dashboard: {
        query: dashQuery,
        metricKeys: dashboardMetricKeys,
        filteredMetricKeys: filteredDashboardSpecs.map((s) => s.key),
        correlation: dashCorrelation
          ? { x: dashCorX, y: dashCorY, r: dashCorrelation.r, n: Math.min(dashCorrelation.xs.length, dashCorrelation.ys.length) }
          : null,
        stats: dashboardStatRows,
      },
    };
    downloadTextFile({ filename: `experiment_dashboard_${dashboardRun.id}.json`, content: JSON.stringify(payload, null, 2), mime: "application/json;charset=utf-8" });
  }, [dashCorX, dashCorY, dashCorrelation, dashQuery, dashboardMetricKeys, dashboardRun, dashboardSamplingMs, dashboardStatRows, filteredDashboardSpecs]);

  const exportExperimentDashboardMarkdown = useCallback(() => {
    if (!dashboardRun) return;
    const header = `# Dashboard do Experimento\n\n- Run: ${escapeMd(dashboardRun.id)}\n- Período: ${escapeMd(new Date(dashboardRun.startedAt).toLocaleString())} → ${escapeMd(new Date(dashboardRun.endedAt).toLocaleString())}\n- Duração: ${dashboardRun.config.general.durationS}s\n- Amostragem: ${dashboardSamplingMs}ms\n- Status: ${escapeMd(dashboardRun.status)}\n- Query: ${escapeMd(dashQuery || "(vazio)")}\n`;

    const corr = dashCorrelation
      ? `\n## Correlação\n\n- X: ${escapeMd(dashCorX)}\n- Y: ${escapeMd(dashCorY)}\n- Pearson r: **${dashCorrelation.r.toFixed(3)}** (n=${Math.min(dashCorrelation.xs.length, dashCorrelation.ys.length)})\n`
      : `\n## Correlação\n\n- (não selecionada)\n`;

    const tableHeader = `\n## Sumário Estatístico\n\n| key | média | mediana | σ | var | p95 | p99 | IC95% | outliers(z≥3) | n |\n|---|---:|---:|---:|---:|---:|---:|---|---:|---:|\n`;
    const lines = dashboardStatRows
      .map((r) => {
        const ci = `${r.ciLow.toFixed(3)} – ${r.ciHigh.toFixed(3)}`;
        return `| ${escapeMd(r.key)} | ${r.mean.toFixed(3)} | ${r.median.toFixed(3)} | ${r.std.toFixed(3)} | ${r.var.toFixed(3)} | ${r.p95.toFixed(3)} | ${r.p99.toFixed(3)} | ${escapeMd(ci)} | ${r.outliersZ3} | ${r.n} |`;
      })
      .join("\n");

    const md = `${header}${corr}${tableHeader}${lines}\n`;
    downloadTextFile({ filename: `experiment_dashboard_${dashboardRun.id}.md`, content: md, mime: "text/markdown;charset=utf-8" });
  }, [dashCorX, dashCorY, dashCorrelation, dashQuery, dashboardRun, dashboardSamplingMs, dashboardStatRows]);

  const exportExperimentDashboardLatex = useCallback(
    (style: "ieee" | "acm") => {
      if (!dashboardRun) return;

      const title = escapeLatex(`Dashboard do Experimento (Run ${dashboardRun.id})`);
      const name = escapeLatex(dashboardRun.config.general.name ?? "Experimento");
      const desc = escapeLatex(dashboardRun.config.general.scientificDescription ?? "");
      const status = escapeLatex(dashboardRun.status);
      const query = escapeLatex(dashQuery || "(vazio)");

      const corrLine = dashCorrelation
        ? `Correlação Pearson entre \\texttt{${escapeLatex(dashCorX)}} e \\texttt{${escapeLatex(dashCorY)}}: $r=${dashCorrelation.r.toFixed(3)}$ (n=${Math.min(dashCorrelation.xs.length, dashCorrelation.ys.length)}).`
        : `Correlação não selecionada.`;

      const tableRows = dashboardStatRows
        .map((r) =>
          [
            `\\texttt{${escapeLatex(r.key)}}`,
            r.mean.toFixed(3),
            r.median.toFixed(3),
            r.std.toFixed(3),
            r.p95.toFixed(3),
            r.p99.toFixed(3),
            `${r.ciLow.toFixed(3)}\\,--\\,${r.ciHigh.toFixed(3)}`,
            String(r.outliersZ3),
            String(r.n),
          ].join(" & ") + ` \\\\`,
        )
        .join("\n");

      const commonPkgs = `\\usepackage{booktabs}\n\\usepackage{amsmath}\n\\usepackage{url}\n`;
      const docStart =
        style === "ieee"
          ? `\\documentclass[conference]{IEEEtran}\n${commonPkgs}\\begin{document}\n\\title{${title}}\n\\author{\\IEEEauthorblockN{Author Name}\\IEEEauthorblockA{Institution\\\\email@example.com}}\n\\maketitle\n`
          : `\\documentclass[sigconf]{acmart}\n${commonPkgs}\\begin{document}\n\\title{${title}}\n\\author{Author Name}\n\\affiliation{\\institution{Institution}}\n\\email{email@example.com}\n\\maketitle\n`;

      const body = `\\begin{abstract}\nRelatório gerado automaticamente a partir de uma execução reprodutível do framework.\n\\end{abstract}\n\n\\section{Configuração da Run}\nNome: ${name}.\\\\\nStatus: ${status}.\\\\\nDuração: ${dashboardRun.config.general.durationS}s.\\\\\nAmostragem: ${dashboardSamplingMs}ms.\\\\\nQuery: ${query}.\\\\\nDescrição: ${desc}.\n\n\\section{Resultados}\n${corrLine}\n\n\\begin{table*}[t]\n\\centering\n\\caption{Sumário estatístico das métricas (média/mediana/desvio/p95/p99/IC95 e outliers por Z-score).}\n\\begin{tabular}{lrrrrrrrr}\n\\toprule\nMétrica & Média & Mediana & $\\sigma$ & p95 & p99 & IC95\\% & Outliers & n\\\\\n\\midrule\n${tableRows}\n\\bottomrule\n\\end{tabular}\n\\end{table*}\n\n\\section{Reprodutibilidade}\nA Run é identificada por \\texttt{${escapeLatex(dashboardRun.id)}} (seed=${dashboardRun.seed}).\n`;

      const docEnd = `\\end{document}\n`;

      const tex = `${docStart}${body}${docEnd}`;
      const suffix = style === "ieee" ? "IEEEtran" : "acmart";
      downloadTextFile({ filename: `experiment_dashboard_${dashboardRun.id}_${suffix}.tex`, content: tex, mime: "application/x-tex;charset=utf-8" });
    },
    [dashCorX, dashCorY, dashCorrelation, dashQuery, dashboardRun, dashboardSamplingMs, dashboardStatRows],
  );

  const exportExperimentDashboardPdf = useCallback(() => {
    if (!dashboardRun) return;

    const rows = dashboardStatRows
      .map(
        (s) =>
          `<tr><td style="font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${s.key}</td><td>${s.mean.toFixed(3)}</td><td>${s.median.toFixed(3)}</td><td>${s.std.toFixed(3)}</td><td>${s.var.toFixed(3)}</td><td>${s.p95.toFixed(3)}</td><td>${s.p99.toFixed(3)}</td><td>${s.ciLow.toFixed(3)} – ${s.ciHigh.toFixed(3)}</td><td>${s.outliersZ3}</td><td>${s.n}</td></tr>`,
      )
      .join("");

    const corr = dashCorrelation
      ? `<div class="muted"><b>Correlação</b>: <code>${dashCorX}</code> vs <code>${dashCorY}</code> · r=${dashCorrelation.r.toFixed(3)} (n=${Math.min(dashCorrelation.xs.length, dashCorrelation.ys.length)})</div>`
      : `<div class="muted"><b>Correlação</b>: —</div>`;

    const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<title>Dashboard do Experimento ${escapeHtml(dashboardRun.id)}</title>
<style>
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; margin:24px; color:#111;}
  h1{font-size:18px; margin:0 0 8px 0;}
  .muted{color:#444; font-size:12px;}
  table{border-collapse:collapse; width:100%; font-size:12px; margin-top:12px;}
  th,td{border:1px solid #ddd; padding:6px 8px; text-align:left;}
  th{background:#f6f6f6;}
  code{font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px;}
  .meta{display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px;}
  .box{border:1px solid #ddd; padding:10px; border-radius:10px;}
</style>
</head>
<body>
  <h1>Dashboard do Experimento (Run <code>${escapeHtml(dashboardRun.id)}</code>)</h1>
  <div class="muted">${escapeHtml(new Date(dashboardRun.startedAt).toLocaleString())} → ${escapeHtml(new Date(dashboardRun.endedAt).toLocaleString())} · sampling=${dashboardSamplingMs}ms · duration=${dashboardRun.config.general.durationS}s · status=${escapeHtml(dashboardRun.status)}</div>
  <div class="meta">
    <div class="box">
      <div class="muted"><b>Experimento</b></div>
      <div><b>${escapeHtml(dashboardRun.config.general.name)}</b></div>
      <div class="muted">${escapeHtml(dashboardRun.config.general.scientificDescription || "—")}</div>
      <div style="margin-top:8px" class="muted"><b>Query</b>: <code>${escapeHtml(dashQuery || "(vazio)")}</code></div>
      ${dashboardRun.insight ? `<div style="margin-top:8px" class="muted"><b>Insight</b>: ${escapeHtml(dashboardRun.insight)}</div>` : ""}
    </div>
    <div class="box">
      ${corr}
      <div style="margin-top:8px" class="muted"><b>Métricas (filtradas)</b>: <code>${escapeHtml(filteredDashboardSpecs.map((s) => s.key).join(", ") || "—")}</code></div>
    </div>
  </div>

  <table>
    <thead><tr>
      <th>Métrica</th><th>Média</th><th>Mediana</th><th>σ</th><th>Var</th><th>p95</th><th>p99</th><th>IC95%</th><th>Outliers(z≥3)</th><th>n</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <script>
    setTimeout(() => { try { window.print(); } catch {} }, 60);
  </script>
</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank");
    if (w) setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }, [dashCorX, dashCorY, dashCorrelation, dashQuery, dashboardRun, dashboardSamplingMs, dashboardStatRows, filteredDashboardSpecs]);

  const runDurationMs = Math.max(1, Math.round((runMetaRef.current?.configSnapshot?.general?.durationS ?? config.general.durationS) * 1000));
  const progressPct = runStatus === "idle" ? 0 : (1 - runRemainingMs / runDurationMs) * 100;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold tracking-tight">Experimentos</div>
          <div className="text-[11px] text-fg-1">Núcleo de execução · Runs reprodutíveis</div>
        </div>

        <div className="flex items-center gap-1">
          <Button variant={tab === "manual" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("manual")}>
            Experimento Manual
          </Button>
          <Button variant={tab === "templates" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("templates")}>
            Biblioteca de Templates
          </Button>
          <Button variant={tab === "dashboard" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("dashboard")}>
            Dashboard do Experimento
          </Button>
        </div>
      </div>

      {tab === "templates" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {templates.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              onCloneAndEdit={() => {
                setConfig(JSON.parse(JSON.stringify(t.params)) as ManualExperimentConfig);
                setSelectedMetricKeys(new Set(t.params.telemetry.metricKeys ?? []));
                setActiveTemplateId(t.id);
                setTab("manual");
              }}
            />
          ))}
        </div>
      ) : tab === "dashboard" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader
              title="Dashboard do Experimento (Análise Estatística)"
              right={
                <div className="flex flex-wrap items-center gap-1">
                  <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={exportExperimentDashboardPdf}>
                    Exportar PDF
                  </Button>
                  <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportExperimentDashboardLatex("ieee")}>
                    LaTeX (IEEE)
                  </Button>
                  <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportExperimentDashboardLatex("acm")}>
                    LaTeX (ACM)
                  </Button>
                  <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={exportExperimentDashboardMarkdown}>
                    Markdown
                  </Button>
                  <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={exportExperimentDashboardJson}>
                    JSON
                  </Button>
                </div>
              }
            />
            <CardBody className="space-y-3">
              {history.length === 0 ? (
                <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3 text-[11px] text-fg-1">Nenhuma Run encontrada no histórico.</div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr]">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1">Run</div>
                    <Select
                      value={dashboardRun?.id ?? ""}
                      onChange={(e) => {
                        const id = e.target.value;
                        setDashboardRunId(id);
                        try {
                          const ls = safeLocalStorage();
                          if (ls) {
                            ls.setItem("netops.experiments.dashboard.runId", id);
                          }
                        } catch {
                          // ignore
                        }
                      }}
                    >
                      {history.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.id} · {new Date(r.startedAt).toLocaleString()}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1">Buscar métrica</div>
                    <Input value={dashQuery} onChange={(e) => setDashQuery(e.target.value)} placeholder="ex: tcp_rtt, loss, throughput" />
                  </div>

                  <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3 text-[11px] text-fg-1 lg:col-span-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-fg-0">{dashboardRun?.config.general.name ?? "—"}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-fg-1">{dashboardRun?.id}</div>
                      </div>
                      <div className={cn("font-mono text-[11px]", dashboardRun?.status === "Sucesso" ? "text-accent-ok" : "text-accent-danger")}>
                        {dashboardRun?.status ?? "—"}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-fg-1">Duração</div>
                        <div className="font-mono text-[11px] text-fg-0">{dashboardRun?.config.general.durationS ?? "—"}s</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-fg-1">Amostragem</div>
                        <div className="font-mono text-[11px] text-fg-0">{dashboardSamplingMs}ms</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-fg-1">Métricas</div>
                        <div className="font-mono text-[11px] text-fg-0">{dashboardMetricKeys.length}</div>
                      </div>
                    </div>
                    {dashboardRun?.insight ? <div className="mt-2 text-[11px] text-fg-1">{dashboardRun.insight}</div> : null}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {history.length > 0 ? (
            <Card>
              <CardHeader title="Correlação (Pearson r)" right={<span className="font-mono text-[11px]">scatter</span>} />
              <CardBody className="space-y-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1">X</div>
                    <Select value={dashCorX} onChange={(e) => setDashCorX(e.target.value)}>
                      <option value="">Selecione</option>
                      {dashboardMetricKeys.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1">Y</div>
                    <Select value={dashCorY} onChange={(e) => setDashCorY(e.target.value)}>
                      <option value="">Selecione</option>
                      {dashboardMetricKeys.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                {dashCorrelation ? (
                  <div className="grid grid-cols-1 gap-2 lg:grid-cols-[260px_1fr]">
                    <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3 text-[11px] text-fg-1">
                      <div className="mb-1">
                        r=<span className="font-mono text-fg-0">{dashCorrelation.r.toFixed(3)}</span>
                      </div>
                      <div className="text-[10px] text-fg-1">(n={Math.min(dashCorrelation.xs.length, dashCorrelation.ys.length)})</div>
                    </div>
                    <div className="text-fg-0">
                      <MiniScatter x={dashCorrelation.xs} y={dashCorrelation.ys} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3 text-[11px] text-fg-1">Selecione duas métricas diferentes.</div>
                )}
              </CardBody>
            </Card>
          ) : null}

          {filteredDashboardSpecs.length === 0 ? (
            <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3 text-[11px] text-fg-1">Nenhuma métrica corresponde à busca.</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
              {filteredDashboardSpecs.map((spec) => {
                const series = dashboardSeriesMap[spec.key] ?? [];
                const markers = dashboardMarkers.filter((m) => m.index >= 0 && m.index < series.length);
                return <ExperimentMetricCard key={spec.key} spec={spec} series={series} markers={markers} />;
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="Experimento Manual (Criação Dinâmica)" right={<span className="font-mono">run</span>} />
              <CardBody className="space-y-4">
                {/* Configurações Gerais */}
                <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                  <div className="mb-2 text-[11px] font-semibold text-fg-0">Configurações Gerais</div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div className="lg:col-span-2">
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Nome do Experimento</div>
                      <Input value={config.general.name} onChange={(e) => updateConfig((p) => ({ ...p, general: { ...p.general, name: e.target.value } }))} />
                    </div>
                    <div className="lg:col-span-2">
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Descrição Científica</div>
                      <Input value={config.general.scientificDescription} onChange={(e) => updateConfig((p) => ({ ...p, general: { ...p.general, scientificDescription: e.target.value } }))} placeholder="Hipótese, método, variáveis..." />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Duração (segundos)</div>
                      <Input type="number" min={1} value={config.general.durationS} onChange={(e) => updateConfig((p) => ({ ...p, general: { ...p.general, durationS: Number(e.target.value) } }))} />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Intervalo de Amostragem (ms)</div>
                      <Input type="number" min={50} value={config.general.samplingMs} onChange={(e) => updateConfig((p) => ({ ...p, general: { ...p.general, samplingMs: Number(e.target.value) } }))} />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Número de Repetições</div>
                      <Input type="number" min={1} max={100} value={config.general.repeatCount ?? 1} onChange={(e) => updateConfig((p) => ({ ...p, general: { ...p.general, repeatCount: Number(e.target.value) } }))} />
                    </div>
                  </div>
                </div>

                {/* Execução em Lote (Batch) */}
                <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-fg-0">Execução em Lote (Batch Execution)</div>
                      <div className="mt-0.5 text-[11px] text-fg-1">Itera automaticamente <span className="font-mono">traffic.rateValue</span> para estresse/escalabilidade.</div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] text-fg-1">
                      <input type="checkbox" checked={batchEnabled} onChange={(e) => setBatchEnabled(e.target.checked)} />
                      Habilitar
                    </label>
                  </div>

                  <div className={cn("grid grid-cols-1 gap-3 lg:grid-cols-3", !batchEnabled && "opacity-60")}> 
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Repetições</div>
                      <Input type="number" min={2} max={50} disabled={!batchEnabled || runStatus === "running" || runStatus === "paused"} value={batchCount} onChange={(e) => setBatchCount(Number(e.target.value))} />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Incremento ({config.traffic.rateUnit})</div>
                      <Input type="number" min={0} disabled={!batchEnabled || runStatus === "running" || runStatus === "paused"} value={batchStep} onChange={(e) => setBatchStep(Number(e.target.value))} />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Variável</div>
                      <Input disabled value="traffic.rateValue" />
                    </div>
                  </div>
                </div>

                {/* Definição de Tráfego */}
                <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                  <div className="mb-2 text-[11px] font-semibold text-fg-0">Definição de Tráfego</div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Origem</div>
                      <Select value={config.traffic.srcHostId} onChange={(e) => updateConfig((p) => ({ ...p, traffic: { ...p.traffic, srcHostId: e.target.value } }))}>
                        {HOST_IDS.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Destino</div>
                      <Select value={config.traffic.dstHostId} onChange={(e) => updateConfig((p) => ({ ...p, traffic: { ...p.traffic, dstHostId: e.target.value } }))}>
                        {HOST_IDS.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Tipo de Tráfego</div>
                      <Select value={config.traffic.type} onChange={(e) => updateConfig((p) => ({ ...p, traffic: { ...p.traffic, type: e.target.value as TrafficType } }))}>
                        {(["TCP", "UDP", "ICMP", "HTTP", "gRPC"] as TrafficType[]).map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Carga/Taxa</div>
                      <div className="grid grid-cols-[1fr_120px] gap-2">
                        <Input type="number" min={0} value={config.traffic.rateValue} onChange={(e) => updateConfig((p) => ({ ...p, traffic: { ...p.traffic, rateValue: Number(e.target.value) } }))} />
                        <Select value={config.traffic.rateUnit} onChange={(e) => updateConfig((p) => ({ ...p, traffic: { ...p.traffic, rateUnit: e.target.value as RateUnit } }))}>
                          <option value="pps">Pacotes/seg</option>
                          <option value="Mbps">Mbps</option>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Seletor de Telemetria */}
                <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-fg-0">Seletor de Telemetria (Métricas L0–L7)</div>
                      <div className="mt-0.5 text-[11px] text-fg-1">Selecione as métricas a coletar durante a Run.</div>
                    </div>
                    <div className="text-[11px] text-fg-1">
                      <span className="font-mono">selecionadas={selectedMetricKeys.size}</span>
                    </div>
                  </div>

                  {validation ? (
                    <div className="mb-2 rounded-lg border border-accent-danger/40 bg-accent-danger/10 p-2 text-[11px] text-accent-danger">
                      {validation}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    {L0_L7.map((layer) => (
                      <LayerGroup key={layer} layer={layer} selectedKeys={selectedMetricKeys} setSelectedKeys={setSelectedMetricKeys} />
                    ))}
                  </div>
                </div>

                {/* Ações Pré/Pós Execução */}
                <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                  <div className="mb-2 text-[11px] font-semibold text-fg-0">Ações Pré/Pós Execução</div>
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Pré-execução (script/comandos)</div>
                      <textarea
                        value={config.scripts.pre}
                        onChange={(e) => updateConfig((p) => ({ ...p, scripts: { ...p.scripts, pre: e.target.value } }))}
                        className={cn(
                          "h-28 w-full resize-none rounded-lg border border-border-0/60 bg-bg-2/20 px-3 py-2",
                          "text-[12px] text-fg-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ok/50",
                        )}
                        placeholder="# Ex: preparar ambiente\n# cmd: ..."
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1">Pós-execução (script/comandos)</div>
                      <textarea
                        value={config.scripts.post}
                        onChange={(e) => updateConfig((p) => ({ ...p, scripts: { ...p.scripts, post: e.target.value } }))}
                        className={cn(
                          "h-28 w-full resize-none rounded-lg border border-border-0/60 bg-bg-2/20 px-3 py-2",
                          "text-[12px] text-fg-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ok/50",
                        )}
                        placeholder="# Ex: coletar artefatos\n# cmd: ..."
                      />
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Histórico de Execuções (Runs)" right={
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-fg-1">{history.length} run{history.length !== 1 ? "s" : ""}</span>
                  {saveDir && (
                    <span className="rounded-md bg-accent-ok/15 px-2 py-0.5 font-mono text-[10px] text-accent-ok">
                      💾 {saveDirName}
                    </span>
                  )}
                </div>
              } />
              <CardBody>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] text-fg-1">Selecione 2+ runs finalizadas para A/B Testing.</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {importStatus && (
                      <span className="text-[11px] text-accent-ok">{importStatus}</span>
                    )}
                    <Button
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => importFileRef.current?.click()}
                    >
                      ↑ Importar Bundle
                    </Button>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void importBundle(file);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={() => {
                        setSelectedHistoryIds(new Set());
                        setCompareOpen(false);
                      }}
                    >
                      Limpar Seleção
                    </Button>
                    <Button
                      disabled={selectedRunsForCompare.length < 2}
                      className="h-7 px-2 text-[11px]"
                      onClick={() => setCompareOpen(true)}
                    >
                      Comparar Resultados
                    </Button>
                  </div>
                </div>

                <div className="overflow-auto rounded-lg border border-border-0/60">
                  <table className="w-full min-w-[720px] border-collapse text-left text-xs">
                    <thead className="bg-bg-1/60">
                      <tr className="border-b border-border-0/60 text-[10px] uppercase tracking-wide text-fg-1">
                        <th className="px-2 py-2 font-medium">Sel</th>
                        <th className="px-2 py-2 font-medium">Nome</th>
                        <th className="px-2 py-2 font-medium">ID</th>
                        <th className="px-2 py-2 font-medium">Data</th>
                        <th className="px-2 py-2 font-medium">Status</th>
                        <th className="px-2 py-2 font-medium">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.length === 0 ? (
                        <tr>
                          <td className="px-2 py-3 text-[11px] text-fg-1" colSpan={6}>—</td>
                        </tr>
                      ) : (
                        history.map((r) => (
                          <tr key={r.id} className="border-b border-border-0/30 hover:bg-bg-2/20">
                            <td className="px-2 py-2">
                              <input
                                type="checkbox"
                                checked={selectedHistoryIds.has(r.id)}
                                onChange={(e) => {
                                  const next = new Set(selectedHistoryIds);
                                  if (e.target.checked) next.add(r.id);
                                  else next.delete(r.id);
                                  setSelectedHistoryIds(next);
                                }}
                              />
                            </td>
                            <td className="max-w-[160px] truncate px-2 py-2 text-[11px] text-fg-0" title={r.config.general.name}>
                              {r.config.general.name || "—"}
                            </td>
                            <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{r.id}</td>
                            <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{new Date(r.startedAt).toLocaleString()}</td>
                            <td className={cn("px-2 py-2 font-mono text-[11px]", r.status === "Sucesso" ? "text-accent-ok" : "text-accent-danger")}>
                              {r.status}
                            </td>
                            <td className="px-2 py-2">
                              <div className="flex flex-wrap items-center gap-1">
                                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => inspectRun(r)}>
                                  Inspecionar Dados
                                </Button>
                                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportRunDataset(r, "csv")}>
                                  Exportar CSV
                                </Button>
                                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportRunDataset(r, "json")}>
                                  Exportar JSON
                                </Button>
                                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportRunPdf(r)}>
                                  Relatório PDF
                                </Button>
                                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportControlPlaneLog(r, "txt")}>
                                  Log OF
                                </Button>
                                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => exportBundle(r)}>
                                  ↓ Bundle
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {compareOpen ? (
                  <div className="mt-3 space-y-3 rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold text-fg-0">Comparação de Runs (A/B Testing)</div>
                        <div className="mt-0.5 text-[11px] text-fg-1">Gráficos sobrepostos + estatística para validar hipóteses.</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setCompareOpen(false)}>Fechar</Button>
                      </div>
                    </div>

                    {commonMetricKeys.length === 0 ? (
                      <div className="rounded-lg border border-accent-danger/40 bg-accent-danger/10 p-2 text-[11px] text-accent-danger">
                        As Runs selecionadas não têm métricas em comum.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
                        <div className="rounded-lg border border-border-0/60 bg-bg-1/30 p-2">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[11px] text-fg-1">Métrica</div>
                            <div className="flex items-center gap-2">
                              <Select value={compareMetricKey} onChange={(e) => setCompareMetricKey(e.target.value)}>
                                {commonMetricKeys.map((k) => (
                                  <option key={k} value={k}>{k}</option>
                                ))}
                              </Select>
                              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-fg-1">
                                <input type="checkbox" checked={compareOutliers} onChange={(e) => setCompareOutliers(e.target.checked)} />
                                Z-score (outliers)
                              </label>
                            </div>
                          </div>

                          {compareSeries ? (
                            <div className="text-fg-0">
                              <MultiSparkline series={compareSeries} outliersById={compareOutliersById} />
                            </div>
                          ) : (
                            <div className="text-[11px] text-fg-1">—</div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/30 p-2">
                            <div className="mb-2 text-[11px] font-semibold text-fg-0">Estatística (métrica selecionada)</div>
                            <div className="space-y-2">
                              {selectedRunsForCompare.map((r, idx) => {
                                const arr = r.seriesMap?.[compareMetricKey] ?? [];
                                const ci = confidenceInterval95(arr);
                                const label = r.batch ? `Lote ${r.batch.index}/${r.batch.total} (${r.config.traffic.rateValue}${r.config.traffic.rateUnit})` : `Run ${idx + 1}`;
                                return (
                                  <div key={r.id} className="rounded-md border border-border-0/60 bg-bg-2/10 p-2">
                                    <div className="font-mono text-[10px] text-fg-1">{label}</div>
                                    <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-fg-1">
                                      <div>média <span className="font-mono text-fg-0">{mean(arr).toFixed(3)}</span></div>
                                      <div>mediana <span className="font-mono text-fg-0">{median(arr).toFixed(3)}</span></div>
                                      <div>σ <span className="font-mono text-fg-0">{stddev(arr).toFixed(3)}</span></div>
                                      <div>var <span className="font-mono text-fg-0">{variance(arr).toFixed(3)}</span></div>
                                      <div>p95 <span className="font-mono text-fg-0">{p95(arr).toFixed(3)}</span></div>
                                      <div>p99 <span className="font-mono text-fg-0">{p99(arr).toFixed(3)}</span></div>
                                      <div className="col-span-2">IC95% <span className="font-mono text-fg-0">{ci.low.toFixed(3)} – {ci.high.toFixed(3)}</span> (n={ci.n})</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          <div className="rounded-lg border border-border-0/60 bg-bg-1/30 p-2">
                            <div className="mb-2 text-[11px] font-semibold text-fg-0">Box Plot (distribuição)</div>
                            {compareMetricKey ? (
                              <div className="text-fg-0">
                                <MiniBoxPlot values={(selectedRunsForCompare[0]?.seriesMap?.[compareMetricKey] ?? []) as number[]} />
                              </div>
                            ) : (
                              <div className="text-[11px] text-fg-1">—</div>
                            )}
                          </div>

                          <div className="rounded-lg border border-border-0/60 bg-bg-1/30 p-2">
                            <div className="mb-2 text-[11px] font-semibold text-fg-0">Correlação (Pearson r)</div>
                            <div className="grid grid-cols-2 gap-2">
                              <Select value={corX} onChange={(e) => setCorX(e.target.value)}>
                                <option value="">X (métrica)</option>
                                {commonMetricKeys.map((k) => (
                                  <option key={k} value={k}>{k}</option>
                                ))}
                              </Select>
                              <Select value={corY} onChange={(e) => setCorY(e.target.value)}>
                                <option value="">Y (métrica)</option>
                                {commonMetricKeys.map((k) => (
                                  <option key={k} value={k}>{k}</option>
                                ))}
                              </Select>
                            </div>
                            {correlation ? (
                              <div className="mt-2">
                                <div className="mb-1 text-[11px] text-fg-1">r=<span className="font-mono text-fg-0">{correlation.r.toFixed(3)}</span> (Run base)</div>
                                <div className="text-fg-0">
                                  <MiniScatter x={correlation.xs} y={correlation.ys} />
                                </div>
                              </div>
                            ) : (
                              <div className="mt-2 text-[11px] text-fg-1">Selecione duas métricas diferentes.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Gestão de Runs" right={<span className="font-mono">control</span>} />
              <CardBody className="space-y-3">

                {/* ── Pasta de Saída ─────────────────────────────────────── */}
                <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-semibold text-fg-0">Pasta de Saída</div>
                      <div className="mt-0.5 text-[10px] text-fg-1">
                        Os experimentos serão salvos automaticamente nessa pasta e recarregados ao abrir a plataforma.
                      </div>
                    </div>
                  </div>

                  {!fsSupported ? (
                    <div className="rounded-lg border border-border-0/40 bg-bg-2/10 px-2 py-1.5 text-[10px] text-fg-1">
                      Seu browser não suporta a File System Access API. Use Chrome/Edge para habilitar esta funcionalidade.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant={saveDir ? "ghost" : "primary"}
                          className="h-7 px-3 text-[11px]"
                          onClick={chooseSaveDir}
                        >
                          {saveDir ? "Alterar Pasta" : "Escolher Pasta…"}
                        </Button>
                        {saveDir && (
                          <Button
                            variant="ghost"
                            className="h-7 px-2 text-[11px] text-accent-danger"
                            onClick={removeSaveDir}
                          >
                            Remover
                          </Button>
                        )}
                      </div>

                      {saveDirName ? (
                        <div className="flex items-center gap-1.5 rounded-lg border border-accent-ok/30 bg-accent-ok/10 px-2 py-1.5">
                          <span className="text-accent-ok">📁</span>
                          <span className="truncate font-mono text-[11px] text-fg-0">{saveDirName}</span>
                        </div>
                      ) : (
                        <div className="rounded-lg border border-border-0/40 bg-bg-2/10 px-2 py-1.5 text-[10px] text-fg-1">
                          Nenhuma pasta selecionada — resultados ficam apenas no cache do browser.
                        </div>
                      )}

                      {saveDirStatus && (
                        <div className="text-[11px] text-accent-ok">{saveDirStatus}</div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-[11px] text-fg-1">Status</div>
                    <div className={cn(
                      "font-mono text-[12px]",
                      runStatus === "running" && "text-accent-ok",
                      runStatus === "paused" && "text-fg-0",
                      runStatus === "success" && "text-accent-ok",
                      runStatus === "failed" && "text-accent-danger",
                    )}>
                      {runStatus.toUpperCase()}
                    </div>
                    <div className="text-[11px] text-fg-1">
                      {runId ? <span className="font-mono">id={runId}</span> : <span>—</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <ProgressRing pct={progressPct} />
                      <div>
                        <div className="text-[11px] text-fg-1">
                          Tempo restante {totalRepeats > 1 ? `(Exp. ${currentRepeat}/${totalRepeats})` : ""}
                        </div>
                        <div className="font-mono text-[12px] text-fg-0">{runStatus === "idle" ? "—" : formatRemaining(runRemainingMs)}</div>
                      </div>
                    </div>
                    {totalRepeats > 1 && runStatus !== "idle" && (
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-bg-2/50 flex items-center justify-center">
                          <div className="text-[10px] text-fg-1">🔁</div>
                        </div>
                        <div>
                          <div className="text-[11px] text-fg-1">Tempo total restante</div>
                          <div className="font-mono text-[12px] text-fg-0">
                            {formatRemaining(runRemainingMs + (totalRepeats - currentRepeat) * config.general.durationS * 1000)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={startRun}
                    disabled={runStatus === "running"}
                  >
                    Iniciar
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (runStatus === "running") pauseRun();
                      else if (runStatus === "paused") startRun();
                    }}
                    disabled={runStatus !== "running" && runStatus !== "paused"}
                  >
                    Pausar
                  </Button>
                  <Button variant="danger" onClick={abortRun} disabled={runStatus === "idle" || runStatus === "success" || runStatus === "failed"}>
                    Abortar
                  </Button>
                  <Button variant="ghost" onClick={resetRunUi} disabled={runStatus === "running"}>
                    Limpar
                  </Button>
                </div>

                <div className="rounded-lg border border-border-0/60 bg-bg-2/10 p-2">
                  <div className="mb-2 text-[11px] font-semibold text-fg-0">Marcadores de Eventos (Annotations)</div>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="grid grid-cols-[1fr_140px] gap-2">
                      <Input
                        value={eventLabel}
                        onChange={(e) => setEventLabel(e.target.value)}
                        placeholder="Ex: injetando falha agora"
                        disabled={runStatus === "idle"}
                      />
                      <Button
                        variant="ghost"
                        disabled={runStatus === "idle"}
                        onClick={() => {
                          if (!runStartMs) return;
                          const label = (eventLabel || "Evento").slice(0, 80);
                          const tMs = Date.now() - runStartMs;
                          setAnnotations((p) => [...p, { tMs, label }]);
                          setLogs((p) => [...p, `[${nowIso()}] EVENT · t+${Math.max(0, Math.round(tMs / 1000))}s · ${label}`].slice(-400));
                          setEventLabel("");
                        }}
                      >
                        Marcar Evento
                      </Button>
                    </div>

                    <div className="max-h-28 overflow-auto rounded-md border border-border-0/60 bg-bg-1/30 p-2 text-[11px] text-fg-1">
                      {annotations.length === 0 ? (
                        <div>—</div>
                      ) : (
                        <div className="space-y-1">
                          {annotations.slice(-12).map((a, i) => (
                            <div key={`${a.tMs}-${i}`} className="font-mono text-[10px]">
                              t+{Math.max(0, Math.round(a.tMs / 1000))}s · {a.label}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 text-[10px] text-fg-1">Os eventos serão renderizados como linhas verticais nos gráficos ao inspecionar a Run.</div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Logs em Tempo Real" right={<span className="font-mono">stdout</span>} />
              <CardBody>
                <div className="rounded-lg border border-border-0/60 bg-bg-2/20 p-3">
                  <pre className="max-h-[52vh] overflow-auto text-[11px] leading-relaxed text-fg-0">
                    {logs.length ? logs.join("\n") : "—"}
                  </pre>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

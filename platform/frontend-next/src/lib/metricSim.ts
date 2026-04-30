import type { MetricSpec } from "@/lib/metricsCatalog";

export type SeriesMap = Record<string, number[]>;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Small deterministic PRNG (LCG) so a Run can be reproduced.
function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    // LCG constants from Numerical Recipes
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function seedSeries(spec: MetricSpec, points: number, rnd: () => number) {
  const arr: number[] = [];
  let v = spec.sim.initial;
  for (let i = 0; i < points; i++) {
    if (spec.kind === "bool") {
      arr.push(v > 0.5 ? 1 : 0);
      continue;
    }
    const jitter = (rnd() * 2 - 1) * (spec.sim.step / 2);
    v = clamp(v + jitter, spec.sim.min, spec.sim.max);
    arr.push(v);
  }
  return arr;
}

function updateValue(spec: MetricSpec, last: number, rnd: () => number) {
  if (spec.kind === "bool") {
    const pFlip = 0.015;
    if (rnd() < pFlip) return last > 0.5 ? 0 : 1;
    return last > 0.5 ? 1 : 0;
  }

  if (spec.type === "Counter") {
    const inc = Math.max(0, (rnd() * 2 - 0.2) * spec.sim.step);
    return clamp(last + inc, spec.sim.min, spec.sim.max);
  }

  const delta = (rnd() * 2 - 1) * spec.sim.step;
  return clamp(last + delta, spec.sim.min, spec.sim.max);
}

export function simulateSeriesMap({
  specs,
  points,
  seed,
}: {
  specs: MetricSpec[];
  points: number;
  seed: number;
}): SeriesMap {
  const rnd = makeRng(seed);
  const seriesMap: SeriesMap = {};

  // Make it stable regardless of incoming order.
  const sorted = specs.slice().sort((a, b) => a.key.localeCompare(b.key));

  for (const spec of sorted) {
    const arr = seedSeries(spec, points, rnd);
    let last = arr[arr.length - 1] ?? spec.sim.initial;
    // Push a few extra updates so different specs diverge in a realistic way.
    for (let i = 0; i < Math.max(0, points - arr.length); i++) {
      last = updateValue(spec, last, rnd);
      arr.push(last);
    }
    seriesMap[spec.key] = arr.slice(0, points);
  }

  return seriesMap;
}

export function buildDatasetRows({
  seriesMap,
  metricKeys,
  startedAtMs,
  samplingMs,
}: {
  seriesMap: SeriesMap;
  metricKeys: string[];
  startedAtMs: number;
  samplingMs: number;
}) {
  const keys = metricKeys.slice();
  const n = Math.max(0, ...keys.map((k) => (seriesMap[k]?.length ?? 0)));
  const rows: Array<Record<string, number | string>> = [];

  for (let i = 0; i < n; i++) {
    const ts = new Date(startedAtMs + i * samplingMs).toISOString();
    const row: Record<string, number | string> = { ts };
    for (const k of keys) {
      const v = seriesMap[k]?.[i];
      row[k] = typeof v === "number" ? v : NaN;
    }
    rows.push(row);
  }

  return rows;
}

export function datasetToCsv(rows: Array<Record<string, number | string>>, metricKeys: string[]) {
  const headers = ["ts", ...metricKeys];
  const escape = (s: string) => {
    if (s.includes(",") || s.includes("\n") || s.includes('"')) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };

  const lines: string[] = [];
  lines.push(headers.join(","));
  for (const r of rows) {
    const fields = headers.map((h) => {
      const v = r[h];
      if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
      return escape(String(v ?? ""));
    });
    lines.push(fields.join(","));
  }
  return lines.join("\n");
}

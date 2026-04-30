"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "@/lib/sim";
import type { MetricSpec } from "@/lib/metricsCatalog";

type SeriesMap = Record<string, number[]>;

type LastMap = Record<string, number>;

function seedSeries(spec: MetricSpec, points: number) {
  const arr: number[] = [];
  let v = spec.sim.initial;
  for (let i = 0; i < points; i++) {
    if (spec.kind === "bool") {
      arr.push(v > 0.5 ? 1 : 0);
      continue;
    }

    const jitter = (Math.random() * 2 - 1) * (spec.sim.step / 2);
    v = clamp(v + jitter, spec.sim.min, spec.sim.max);
    arr.push(v);
  }
  return arr;
}

function updateValue(spec: MetricSpec, last: number) {
  if (spec.kind === "bool") {
    // Rare flaps to make LED meaningful.
    const pFlip = 0.015;
    if (Math.random() < pFlip) return last > 0.5 ? 0 : 1;
    return last > 0.5 ? 1 : 0;
  }

  if (spec.type === "Counter") {
    const inc = Math.max(0, (Math.random() * 2 - 0.2) * spec.sim.step);
    return clamp(last + inc, spec.sim.min, spec.sim.max);
  }

  const delta = (Math.random() * 2 - 1) * spec.sim.step;
  return clamp(last + delta, spec.sim.min, spec.sim.max);
}

export function useMetricSeriesMap({
  specs,
  points = 36,
  intervalMs = 950,
}: {
  specs: MetricSpec[];
  points?: number;
  intervalMs?: number;
}) {
  const specsByKey = useMemo(() => {
    const m = new Map<string, MetricSpec>();
    for (const s of specs) m.set(s.key, s);
    return m;
  }, [specs]);

  const [seriesMap, setSeriesMap] = useState<SeriesMap>(() => {
    const init: SeriesMap = {};
    for (const spec of specs) init[spec.key] = seedSeries(spec, points);
    return init;
  });

  const lastRef = useRef<LastMap>({});

  // Re-seed when the metric set changes (filters/layer).
  useEffect(() => {
    setSeriesMap((prev) => {
      const next: SeriesMap = {};
      const nextLast: LastMap = {};
      for (const spec of specs) {
        const prevArr = prev[spec.key];
        const seeded = prevArr && prevArr.length === points ? prevArr : seedSeries(spec, points);
        next[spec.key] = seeded;
        nextLast[spec.key] = seeded[seeded.length - 1] ?? spec.sim.initial;
      }
      lastRef.current = nextLast;
      return next;
    });
  }, [specs, points]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSeriesMap((prev) => {
        const next: SeriesMap = { ...prev };
        for (const [key, spec] of specsByKey.entries()) {
          const last = lastRef.current[key] ?? spec.sim.initial;
          const v = updateValue(spec, last);
          lastRef.current[key] = v;
          const arr = prev[key] ?? seedSeries(spec, points);
          next[key] = [...arr.slice(1), v];
        }
        return next;
      });
    }, intervalMs);

    return () => window.clearInterval(id);
  }, [intervalMs, points, specsByKey]);

  return seriesMap;
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { metricsApi, type MetricSample } from "@/lib/api";

const POLL_MS = 3000;
const HISTORY_POINTS = 30;

export type MetricHistory = {
  node: string;
  layer: string;
  metric: string;
  latest: number;
  timestamp: string;
  history: number[]; // últimos HISTORY_POINTS valores
};

export type RealtimeState = {
  metrics: MetricHistory[];
  lastUpdated: string | null;
  online: boolean;
  loading: boolean;
  error: string | null;
};

export function useRealtimeMetrics(): RealtimeState {
  const [metrics, setMetrics] = useState<MetricHistory[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Map key="node||metric" → history buffer
  const historyRef = useRef<Map<string, number[]>>(new Map());

  const poll = useCallback(async () => {
    try {
      const samples: MetricSample[] = await metricsApi.latest();
      const histMap = historyRef.current;

      const updated: MetricHistory[] = samples.map((s) => {
        const key = `${s.node}||${s.metric}`;
        const prev = histMap.get(key) ?? [];
        const next = [...prev, s.value].slice(-HISTORY_POINTS);
        histMap.set(key, next);
        return {
          node: s.node,
          layer: s.layer,
          metric: s.metric,
          latest: s.value,
          timestamp: s.timestamp,
          history: next,
        };
      });

      setMetrics(updated);
      setLastUpdated(new Date().toLocaleTimeString("pt-BR"));
      setOnline(true);
      setError(null);
      setLoading(false);
    } catch (e: unknown) {
      setOnline(false);
      setError(e instanceof Error ? e.message : "Erro ao buscar métricas");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return { metrics, lastUpdated, online, loading, error };
}

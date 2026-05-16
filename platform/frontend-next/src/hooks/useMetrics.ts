"use client";

import { metricsApi, type MetricLayer } from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";

export function useMetricDefinitions() {
  return useAsync(() => metricsApi.definitions(), []);
}

export function useLatestMetrics(params?: {
  metric?: string;
  node?: string;
  layer?: MetricLayer;
}) {
  return useAsync(
    () => metricsApi.latest(params),
    // re-fetch when params change
    [params?.metric, params?.node, params?.layer],
  );
}

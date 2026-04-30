/**
 * NetOps Platform – typed API client
 *
 * In the browser all requests go through the Next.js /api/* rewrite proxy
 * (defined in next.config.mjs) so the real backend host is never exposed
 * in the client bundle.
 *
 * In server/build contexts (e.g. ISR, route handlers) the value of
 * NEXT_PUBLIC_API_URL is used when explicitly set; otherwise falls back
 * to the /api relative prefix which works for local dev too.
 */

export const API_BASE: string =
  typeof window !== "undefined"
    ? "/api"
    : (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) ||
      "/api";

// ─── Shared types (mirrors backend schemas) ────────────────────────────────

export type MetricLayer =
  | "physical"
  | "link"
  | "network"
  | "transport"
  | "session"
  | "presentation"
  | "application"
  | "control"
  | "dataplane"
  | "service";

export type TopologyNode = {
  id: string;
  type: "switch" | "host" | "controller";
  mgmt_ip?: string | null;
  meta: Record<string, unknown>;
};

export type TopologyLink = {
  source: string;
  target: string;
  bandwidth_mbps?: number | null;
  delay_ms?: number | null;
  loss_pct?: number | null;
  meta?: Record<string, unknown>;
};

export type Topology = {
  id: string;
  name?: string | null;
  nodes: TopologyNode[];
  links: TopologyLink[];
};

export type TopologyCreate = Omit<Topology, "id">;
export type TopologyUpdate = Partial<Omit<Topology, "id">>;

export type Experiment = {
  id: string;
  name: string;
  topology_id: string;
  description?: string | null;
  parameters?: Record<string, unknown>;
};

export type ExperimentCreate = Omit<Experiment, "id">;
export type ExperimentUpdate = Partial<Omit<Experiment, "id">>;

export type ExperimentRun = {
  id: string;
  experiment_id: string;
  topology_id: string;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  started_at?: string | null;
  ended_at?: string | null;
  parameters?: Record<string, unknown>;
  logs: string[];
};

export type MetricDefinition = {
  name: string;
  layer?: MetricLayer | null;
  unit?: string | null;
  kind?: string | null;
  dimensions?: string[];
  description?: string | null;
};

export type MetricSample = {
  timestamp: string;
  node: string;
  layer: MetricLayer;
  metric: string;
  value: number;
  details?: Record<string, unknown>;
  labels?: Record<string, unknown>;
};

export type MetricRecord = {
  timestamp: string;
  metric_name: string;
  value: number;
  layer?: MetricLayer | null;
  labels?: Record<string, unknown>;
  details?: Record<string, unknown>;
};

export type MetricQuery = {
  metric_names?: string[];
  nodes?: string[];
  layers?: MetricLayer[];
  start_time?: string;
  end_time?: string;
  limit?: number;
};

export type FlowRule = {
  id?: string | null;
  topology_id: string;
  node_id?: string | null;
  priority?: number;
  match?: Record<string, unknown>;
  actions?: unknown[];
  cookie?: number | null;
  hard_timeout?: number | null;
  idle_timeout?: number | null;
};

export type SavedConfig = {
  id: string;
  name: string;
  active: boolean;
  updated_at?: string | null;
};

export type ConfigPayload = {
  id?: string;
  name: string;
  description?: string;
  environment?: string;
  config: Record<string, unknown>;
  set_active?: boolean;
  [k: string]: unknown;
};

// SSE snapshot event from /stream/events
export type SSESnapshot = {
  type: "snapshot";
  generated_at: string;
  topology: Topology | null;
  metrics: MetricSample[];
  runs: ExperimentRun[];
};

// ─── Experiment bundle types (import/export) ───────────────────────────────

export type ExperimentBundle = {
  version: number;
  exported_at: string;
  experiment: Experiment;
  runs: ExperimentRun[];
  run_metrics: Record<string, MetricRecord[]>;
};

export type ImportResult = {
  imported: boolean;
  experiment_id: string;
  runs_imported: number;
  id_map: Record<string, string>;
};

// ─── HTTP helpers ──────────────────────────────────────────────────────────

async function request<T>(
  path: string,
  options: RequestInit = {},
  apiKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, detail);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function get<T>(path: string, apiKey?: string): Promise<T> {
  return request<T>(path, { method: "GET" }, apiKey);
}

function post<T>(path: string, body: unknown, apiKey?: string): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) }, apiKey);
}

function put<T>(path: string, body: unknown, apiKey?: string): Promise<T> {
  return request<T>(path, { method: "PUT", body: JSON.stringify(body) }, apiKey);
}

function del<T>(path: string, apiKey?: string): Promise<T> {
  return request<T>(path, { method: "DELETE" }, apiKey);
}

// ─── Topology endpoints ────────────────────────────────────────────────────

export const topologyApi = {
  list: (): Promise<Topology[]> => get("/topologies"),
  get: (id: string): Promise<Topology> => get(`/topologies/${id}`),
  create: (payload: TopologyCreate, apiKey?: string): Promise<Topology> =>
    post("/topologies", payload, apiKey),
  update: (id: string, payload: TopologyUpdate, apiKey?: string): Promise<Topology> =>
    put(`/topologies/${id}`, payload, apiKey),
  delete: (id: string, apiKey?: string): Promise<void> =>
    del(`/topologies/${id}`, apiKey),
};

// ─── Experiment endpoints ───────────────────────────────────────────────────

export const experimentApi = {
  list: (): Promise<Experiment[]> => get("/experiments"),
  get: (id: string): Promise<Experiment> => get(`/experiments/${id}`),
  create: (payload: ExperimentCreate, apiKey?: string): Promise<Experiment> =>
    post("/experiments", payload, apiKey),
  update: (id: string, payload: ExperimentUpdate, apiKey?: string): Promise<Experiment> =>
    put(`/experiments/${id}`, payload, apiKey),
  delete: (id: string, apiKey?: string): Promise<void> =>
    del(`/experiments/${id}`, apiKey),
  listRuns: (experimentId: string): Promise<ExperimentRun[]> =>
    get(`/experiments/${experimentId}/runs`),
  startRun: (experimentId: string, mode = "synthetic", apiKey?: string): Promise<ExperimentRun> =>
    post(`/experiments/${experimentId}/run?mode=${mode}`, {}, apiKey),
  /** Download a self-contained JSON bundle for backup / sharing. */
  exportBundle: (experimentId: string): Promise<ExperimentBundle> =>
    get(`/experiments/${experimentId}/export`),
  /** Import a bundle produced by exportBundle(). Returns new IDs. */
  importBundle: (bundle: ExperimentBundle, apiKey?: string): Promise<ImportResult> =>
    post("/experiments/import", bundle, apiKey),
};

// ─── Run endpoints ─────────────────────────────────────────────────────────

export const runApi = {
  get: (id: string): Promise<ExperimentRun> => get(`/runs/${id}`),
  metrics: (id: string): Promise<MetricRecord[]> => get(`/runs/${id}/metrics`),
};

// ─── Metric endpoints ───────────────────────────────────────────────────────

export const metricsApi = {
  definitions: (): Promise<MetricDefinition[]> => get("/metrics/definitions"),
  query: (query: MetricQuery): Promise<MetricSample[]> =>
    post("/metrics/query", query),
  latest: (params?: {
    metric?: string;
    node?: string;
    layer?: MetricLayer;
  }): Promise<MetricSample[]> => {
    const qs = new URLSearchParams();
    if (params?.metric) qs.set("metric", params.metric);
    if (params?.node) qs.set("node", params.node);
    if (params?.layer) qs.set("layer", params.layer);
    const query = qs.toString();
    return get(`/metrics/latest${query ? `?${query}` : ""}`);
  },
  ingestSamples: (samples: MetricSample | MetricSample[], apiKey?: string): Promise<{ stored: number }> =>
    post("/metrics/samples", samples, apiKey),
  collect: (
    mode = "synthetic",
    params?: { run_id?: string; experiment_id?: string; topology_id?: string },
    apiKey?: string,
  ): Promise<{ collected: number; mode: string }> => {
    const qs = new URLSearchParams({ mode });
    if (params?.run_id) qs.set("run_id", params.run_id);
    if (params?.experiment_id) qs.set("experiment_id", params.experiment_id);
    if (params?.topology_id) qs.set("topology_id", params.topology_id);
    return post(`/metrics/collect?${qs.toString()}`, {}, apiKey);
  },
  exportRaw: (layer?: MetricLayer): Promise<string> => {
    const qs = layer ? `?layer=${layer}` : "";
    return fetch(`${API_BASE}/metrics/export${qs}`).then((r) => r.text());
  },
};

// ─── Flow endpoints ─────────────────────────────────────────────────────────

export const flowApi = {
  list: (topologyId?: string): Promise<FlowRule[]> => {
    const qs = topologyId ? `?topology_id=${topologyId}` : "";
    return get(`/flows${qs}`);
  },
  create: (flow: FlowRule, apiKey?: string): Promise<FlowRule> =>
    post("/flows", flow, apiKey),
  delete: (id: string, apiKey?: string): Promise<void> =>
    del(`/flows/${id}`, apiKey),
};

// ─── Config endpoints ───────────────────────────────────────────────────────

export const configApi = {
  list: (): Promise<SavedConfig[]> => get("/configs"),
  getActive: (): Promise<{ active: string | null }> => get("/configs/active"),
  get: (id: string): Promise<ConfigPayload> => get(`/configs/${id}`),
  save: (payload: ConfigPayload, apiKey?: string): Promise<{ saved: boolean; id: string; active: string | null }> =>
    post("/configs", payload, apiKey),
  activate: (id: string, apiKey?: string): Promise<{ active: string }> =>
    post(`/configs/${id}/activate`, {}, apiKey),
  delete: (id: string, apiKey?: string): Promise<{ deleted: boolean }> =>
    del(`/configs/${id}`, apiKey),
};

// ─── Health ────────────────────────────────────────────────────────────────

export const healthApi = {
  check: (): Promise<{ status: string }> => get("/health"),
};

// ─── SSE stream ────────────────────────────────────────────────────────────

/**
 * Opens the /stream/events SSE connection.
 * Returns a cleanup function.
 *
 * @example
 * useEffect(() => openEventStream((snap) => setSnapshot(snap)), []);
 */
export function openEventStream(
  onSnapshot: (data: SSESnapshot) => void,
  onError?: (err: Event) => void,
): () => void {
  const es = new EventSource(`${API_BASE}/stream/events`);

  es.onmessage = (e) => {
    try {
      const data: SSESnapshot = JSON.parse(e.data);
      onSnapshot(data);
    } catch {
      // ignore malformed frames
    }
  };

  if (onError) {
    es.onerror = onError;
  }

  return () => es.close();
}

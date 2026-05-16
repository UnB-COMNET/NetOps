"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import { configApi, API_BASE, type SavedConfig } from "@/lib/api";
import { DataModeToggle } from "./DataModeToggle";

type Tab = "general" | "topology" | "resources" | "telemetry";

type LogLevel = "info" | "debug" | "error";
type CleanupStrategy = "purge" | "keep_assets";
type ControllerType = "ryu" | "onos" | "odl" | "floodlight";
type NodeRole = "controller" | "switch" | "host";
type SwitchType = "ovs" | "user";
type EnvironmentMode = "docker" | "sim";

type ControllerConfig = {
  id: string;
  type: ControllerType;
  api_base_url: string;
  openflow: { host: string; port: number };
  auth: { mode: "none" | "token" | "basic"; token: string | null; username: string | null; password: string | null };
};

type NodeMeta = {
  openflow_version?: string;
  cpu_limit?: string;
  memory_limit?: string;
  env?: Record<string, string>;
  mounts?: Array<{ source: string; target: string; mode?: "ro" | "rw" }>;
  [k: string]: any;
};

type NodeConfig = {
  id: string;
  role: NodeRole;
  type?: SwitchType; // only for switch
  mgmt_ip?: string;
  image?: string;
  container_name?: string;
  bridge?: string;
  datapath_id?: string;
  ofctl?: { host?: string; port?: number };
  meta: NodeMeta;
};

type LinkConfig = {
  source: string;
  target: string;
  bandwidth_mbps?: number;
  delay_ms?: number;
  loss_pct?: number;
  meta?: { max_queue_size?: number; [k: string]: any };
};

type MetricPlan = {
  metrics: string[];
  interval_sec: number;
  labels: string[];
  metric_layers?: Record<string, string>;
};

type PlatformConfig = {
  environment: {
    mode: EnvironmentMode;
    docker_network?: string;
    ssh_key_path?: string;
  };
  controllers: ControllerConfig[];
  default_controller?: string;
  nodes: NodeConfig[];
  links: LinkConfig[];
  metric_plan?: MetricPlan;
  metric_layers?: Record<string, boolean>;
  layer_descriptions?: Record<string, string>;
  metadata?: Record<string, any>;
  // Optional/advanced keys (kept if imported)
  traffic_profiles?: any[];
  flow_templates?: any[];
};

type OrchestrationPayload = {
  id?: string;
  name: string;
  description: string;
  author: string;
  version: string;
  environment: EnvironmentMode;
  orchestration: {
    log_level: LogLevel;
    execution_timeout_sec: number;
    cleanup_strategy: CleanupStrategy;
  };
  telemetry: {
    endpoint_url: string;
    database_name: string;
    sampling_rate_ms: number;
    batch_size: number;
  };
  backend: {
    api_base_url: string;
    api_key: string;
    set_active: boolean;
  };
  config: PlatformConfig;
};

type ValidationErrors = Record<string, string>;

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

function safeJsonParse(raw: string): any | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function highlightJsonToHtml(value: unknown) {
  const json = JSON.stringify(value, null, 2) ?? "";
  const tokenRe = /"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?/g;

  let out = "";
  let lastIndex = 0;
  const matches = json.matchAll(tokenRe);
  for (const m of matches) {
    const idx = m.index ?? 0;
    const token = m[0] ?? "";
    out += escapeHtml(json.slice(lastIndex, idx));

    let cls = "text-fg-0";
    if (token.startsWith('"')) {
      const isKey = token.trimEnd().endsWith(":");
      cls = isKey ? "text-fg-1" : "text-accent-ok";
    } else if (token === "true" || token === "false" || token === "null") {
      cls = "text-fg-1";
    } else {
      cls = "text-fg-0";
    }

    out += `<span class="${cls}">${escapeHtml(token)}</span>`;
    lastIndex = idx + token.length;
  }
  out += escapeHtml(json.slice(lastIndex));
  return out;
}

function normalizeDpId(raw: string) {
  const s = (raw ?? "").trim();
  if (!s) return "";
  // If already looks like 16 hex digits, keep; else strip 0x and non-hex.
  const cleaned = s.toLowerCase().replace(/^0x/, "").replace(/[^0-9a-f]/g, "");
  if (cleaned.length >= 16) return cleaned.slice(-16).padStart(16, "0");
  return cleaned.padStart(16, "0");
}

function parseKvLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = (text ?? "").split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx <= 0) continue;
    const k = t.slice(0, idx).trim();
    const v = t.slice(idx + 1).trim();
    if (!k) continue;
    out[k] = v;
  }
  return out;
}

function formatKvLines(obj: Record<string, string> | undefined) {
  if (!obj) return "";
  return Object.entries(obj)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function validatePayload(p: OrchestrationPayload): ValidationErrors {
  const e: ValidationErrors = {};
  const req = (path: string, ok: boolean, msg: string) => {
    if (!ok) e[path] = msg;
  };

  req("name", Boolean(p.name.trim()), "Experiment Name é obrigatório");
  req("author", Boolean(p.author.trim()), "Author é obrigatório");
  req("version", Boolean(p.version.trim()), "Version é obrigatório");
  req("backend.api_base_url", /^https?:\/\//.test(p.backend.api_base_url.trim()), "Backend API Base URL inválido");

  // Align to backend validate_config(): unique node ids.
  const nodeIds = p.config.nodes.map((n) => n.id).filter(Boolean);
  req("config.nodes", nodeIds.length > 0, "Defina ao menos 1 nó");
  const uniq = new Set(nodeIds);
  req("config.nodes.unique", uniq.size === nodeIds.length, "IDs de nós devem ser únicos");

  // Controllers.
  const ctrlIds = p.config.controllers.map((c) => c.id).filter(Boolean);
  req("config.controllers", ctrlIds.length > 0, "Defina ao menos 1 controlador");
  req("config.default_controller", !p.config.default_controller || ctrlIds.includes(p.config.default_controller), "default_controller deve referenciar um controller.id");

  // Links must reference existing node ids.
  for (let i = 0; i < p.config.links.length; i++) {
    const l = p.config.links[i]!;
    if (!l.source || !l.target) {
      e[`config.links[${i}]`] = "Link precisa de source e target";
      continue;
    }
    if (!uniq.has(l.source) || !uniq.has(l.target)) {
      e[`config.links[${i}]`] = "Link endpoints devem referenciar node ids existentes";
    }
  }

  // Metric plan.
  if (p.config.metric_plan) {
    req("config.metric_plan.metrics", Array.isArray(p.config.metric_plan.metrics) && p.config.metric_plan.metrics.length > 0, "Selecione ao menos 1 métrica");
    req("config.metric_plan.interval_sec", Number.isFinite(p.config.metric_plan.interval_sec) && p.config.metric_plan.interval_sec > 0, "Intervalo deve ser > 0");
  }

  // metric_layers must be allowed keys + boolean flags (align with backend validate_config).
  if (p.config.metric_layers) {
    const allowed = new Set([
      "service",
      "physical",
      "link",
      "network",
      "transport",
      "session",
      "presentation",
      "application",
      "control",
      "dataplane",
    ]);
    for (const [layer, enabled] of Object.entries(p.config.metric_layers)) {
      if (!allowed.has(layer)) {
        e[`config.metric_layers.${layer}`] = `Camada não suportada: ${layer}`;
      }
      if (typeof enabled !== "boolean") {
        e[`config.metric_layers.${layer}`] = "Flags de metric_layers devem ser boolean";
      }
    }
  }

  return e;
}

export function SettingsView() {
  const [tab, setTab] = useState<Tab>("general");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [payload, setPayload] = useState<OrchestrationPayload>(() => {
    // Seed from backend default platform_config.json structure.
    const cfg: PlatformConfig = {
      environment: { mode: "docker", docker_network: "sdn_lab_net", ssh_key_path: "~/.ssh/id_rsa" },
      controllers: [
        {
          id: "ctrl-ryu",
          type: "ryu",
          api_base_url: "http://127.0.0.1:8080",
          openflow: { host: "127.0.0.1", port: 6633 },
          auth: { mode: "none", token: null, username: null, password: null },
        },
      ],
      default_controller: "ctrl-ryu",
      nodes: [
        { id: "c1", role: "controller", mgmt_ip: "172.20.0.10", image: "alexandremitsurukaihara/lst2.0:ryucontroller", container_name: "c1", meta: { ssh_user: "root", ssh_port: 22 } },
        { id: "s1", role: "switch", type: "ovs", mgmt_ip: "172.20.0.11", image: "s1-img", container_name: "s1", bridge: "br-s1", datapath_id: "0000000000000001", ofctl: { host: "172.20.0.11", port: 6640 }, meta: {} },
        { id: "h1", role: "host", mgmt_ip: "172.20.0.12", image: "alexandremitsurukaihara/lst2.0:host", container_name: "h1", meta: { ssh_user: "root", ssh_port: 22 } },
        { id: "h2", role: "host", mgmt_ip: "172.20.0.13", image: "alexandremitsurukaihara/lst2.0:host", container_name: "h2", meta: { ssh_user: "root", ssh_port: 22 } },
      ],
      links: [
        { source: "s1", target: "h1", bandwidth_mbps: 1000, delay_ms: 1, loss_pct: 0.0 },
        { source: "s1", target: "h2", bandwidth_mbps: 1000, delay_ms: 1, loss_pct: 0.0 },
        { source: "s1", target: "c1", bandwidth_mbps: 1000, delay_ms: 1, loss_pct: 0.0 },
      ],
      traffic_profiles: [
        {
          name: "ping-baseline",
          generator: "ping",
          src: "h1",
          dst: "h2",
          protocol: "icmp",
          duration_sec: 30,
          params: { count: "20", interval: "1s" },
        },
      ],
      metric_plan: {
        metrics: ["latency_ms", "packet_loss_pct", "throughput_mbps"],
        interval_sec: 5.0,
        labels: ["experiment_id", "run_id", "topology_id", "src", "dst"],
        metric_layers: { latency_ms: "network", packet_loss_pct: "network", throughput_mbps: "transport" },
      },
      flow_templates: [
        {
          name: "h1_to_h2",
          controller: "ctrl-ryu",
          match: { in_port: "1", eth_type: "0x0800" },
          actions: { output: "2" },
          priority: 100,
        },
        {
          name: "h2_to_h1",
          controller: "ctrl-ryu",
          match: { in_port: "2", eth_type: "0x0800" },
          actions: { output: "1" },
          priority: 100,
        },
      ],
      metric_layers: {
        physical: true,
        link: true,
        network: true,
        transport: true,
        application: true,
        control: true,
        dataplane: true,
      },
      layer_descriptions: {
        physical: "Interface counters, erros, descartes, potencia e temperatura quando disponivel.",
        link: "Utilizacao de enlace, perda e jitter por VLAN/porta/queue.",
        network: "Latencia ICMP, perda, rotas, ARP/ND e reachability.",
        transport: "RTT e retransmissoes TCP, jitter e perda UDP, throughput ativo.",
        application: "Tempo de resposta HTTP/DNS/TLS, disponibilidade de servico.",
        control: "Saude do controlador, latencia control-plane, sessoes OpenFlow.",
        dataplane: "Counters de flows/tabelas OpenFlow e estatisticas de porta.",
      },
      metadata: {},
    };

    return {
      name: "lft-netops",
      description: "Configuração de orquestração do experimento",
      author: "",
      version: "1.0.0",
      environment: "docker",
      orchestration: { log_level: "info", execution_timeout_sec: 600, cleanup_strategy: "keep_assets" },
      telemetry: { endpoint_url: API_BASE, database_name: "netops", sampling_rate_ms: 250, batch_size: 200 },
      backend: { api_base_url: API_BASE, api_key: "", set_active: true },
      config: cfg,
    };
  });

  const errors = useMemo(() => validatePayload(payload), [payload]);
  const isValid = Object.keys(errors).length === 0;

  const preview = useMemo(() => {
    // Backend endpoint expects payload.config to be the platform config object.
    const { backend, telemetry, orchestration, ...rest } = payload;
    return {
      ...rest,
      orchestration,
      telemetry,
      // Align to backend: it accepts set_active at top level.
      set_active: backend.set_active,
      config: payload.config,
    };
  }, [payload]);

  const previewHtml = useMemo(() => highlightJsonToHtml(preview), [preview]);

  const fieldClass = useCallback((path: string) => (errors[path] ? "border-accent-danger/60 focus-visible:ring-accent-danger/30" : ""), [errors]);

  const exportJson = useCallback(() => {
    const filenameBase = (payload.name || "config").trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
    downloadTextFile({ filename: `${filenameBase}.json`, content: JSON.stringify(preview, null, 2), mime: "application/json;charset=utf-8" });
  }, [payload.name, preview]);

  const importJson = useCallback(async (file: File) => {
    const raw = await file.text();
    const obj = safeJsonParse(raw);
    if (!obj || typeof obj !== "object") return;

    // Accept either (A) full payload with {config: {...}} or (B) raw platform_config.json.
    const maybeCfg = (obj as any).config && typeof (obj as any).config === "object" ? (obj as any).config : obj;
    if (!maybeCfg || typeof maybeCfg !== "object") return;

    setPayload((p) => {
      const next: OrchestrationPayload = {
        ...p,
        name: typeof (obj as any).name === "string" ? (obj as any).name : p.name,
        description: typeof (obj as any).description === "string" ? (obj as any).description : p.description,
        author: typeof (obj as any).author === "string" ? (obj as any).author : p.author,
        version: typeof (obj as any).version === "string" ? (obj as any).version : p.version,
        environment: (obj as any).environment === "sim" || (obj as any).environment === "docker" ? (obj as any).environment : p.environment,
        orchestration: typeof (obj as any).orchestration === "object" && (obj as any).orchestration
          ? {
              log_level: (obj as any).orchestration.log_level ?? p.orchestration.log_level,
              execution_timeout_sec: Number((obj as any).orchestration.execution_timeout_sec ?? p.orchestration.execution_timeout_sec),
              cleanup_strategy: (obj as any).orchestration.cleanup_strategy ?? p.orchestration.cleanup_strategy,
            }
          : p.orchestration,
        telemetry: typeof (obj as any).telemetry === "object" && (obj as any).telemetry
          ? {
              endpoint_url: String((obj as any).telemetry.endpoint_url ?? p.telemetry.endpoint_url),
              database_name: String((obj as any).telemetry.database_name ?? p.telemetry.database_name),
              sampling_rate_ms: Number((obj as any).telemetry.sampling_rate_ms ?? p.telemetry.sampling_rate_ms),
              batch_size: Number((obj as any).telemetry.batch_size ?? p.telemetry.batch_size),
            }
          : p.telemetry,
        backend: {
          ...p.backend,
          set_active: Boolean((obj as any).set_active ?? p.backend.set_active),
        },
        config: maybeCfg as PlatformConfig,
      };

      // Keep payload.environment in sync with config.environment.mode
      const mode = (next.config as any)?.environment?.mode;
      if (mode === "docker" || mode === "sim") {
        next.environment = mode;
      }
      return next;
    });
  }, []);

  const applyToBackend = useCallback(async () => {
    if (!isValid) return;
    const url = payload.backend.api_base_url.replace(/\/$/, "") + "/configs";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.backend.api_key ? { "x-api-key": payload.backend.api_key } : {}),
      },
      body: JSON.stringify(preview),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Erro HTTP ${res.status}`);
    }
    return res.json().catch(() => ({}));
  }, [isValid, payload.backend.api_base_url, payload.backend.api_key, preview]);

  const [applyState, setApplyState] = useState<{ status: "idle" | "sending" | "ok" | "error"; msg?: string }>({ status: "idle" });

  // ── Saved configs from backend ────────────────────────────────────────────
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [savedConfigsLoading, setSavedConfigsLoading] = useState(false);

  const reloadSavedConfigs = useCallback(async () => {
    setSavedConfigsLoading(true);
    try {
      const list = await configApi.list();
      setSavedConfigs(list);
    } catch {
      // backend offline – ignore
    } finally {
      setSavedConfigsLoading(false);
    }
  }, []);

  useEffect(() => { reloadSavedConfigs(); }, [reloadSavedConfigs]);

  const loadConfigFromBackend = useCallback(async (id: string) => {
    try {
      const obj = await configApi.get(id);
      await importJson(new File([JSON.stringify(obj)], `${id}.json`, { type: "application/json" }));
    } catch (e: any) {
      setApplyState({ status: "error", msg: `Erro ao carregar config ${id}: ${e?.message ?? e}` });
    }
  }, [importJson]);

  const activateConfigOnBackend = useCallback(async (id: string) => {
    try {
      await configApi.activate(id, payload.backend.api_key || undefined);
      await reloadSavedConfigs();
      setApplyState({ status: "ok", msg: `Config "${id}" ativada.` });
    } catch (e: any) {
      setApplyState({ status: "error", msg: `Erro ao ativar config ${id}: ${e?.message ?? e}` });
    }
  }, [payload.backend.api_key, reloadSavedConfigs]);

  const deleteConfigOnBackend = useCallback(async (id: string) => {
    try {
      await configApi.delete(id, payload.backend.api_key || undefined);
      await reloadSavedConfigs();
      setApplyState({ status: "ok", msg: `Config "${id}" removida.` });
    } catch (e: any) {
      setApplyState({ status: "error", msg: `Erro ao remover config ${id}: ${e?.message ?? e}` });
    }
  }, [payload.backend.api_key, reloadSavedConfigs]);

  const selectedNodeId = payload.config.nodes[0]?.id ?? "";
  const [nodeForResources, setNodeForResources] = useState<string>(selectedNodeId);

  const selectedNode = useMemo(() => payload.config.nodes.find((n) => n.id === nodeForResources) ?? payload.config.nodes[0] ?? null, [nodeForResources, payload.config.nodes]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_480px]">
      <Card>
        <CardHeader
          title="Configurações (Gerador Oficial do JSON de Orquestração)"
          right={<span className="font-mono text-[11px]">configs</span>}
        />
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <Button variant={tab === "general" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("general")}>
                General & Orchestration
              </Button>
              <Button variant={tab === "topology" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("topology")}>
                Network Topology
              </Button>
              <Button variant={tab === "resources" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("resources")}>
                Node Resources
              </Button>
              <Button variant={tab === "telemetry" ? "primary" : "ghost"} className="h-8" onClick={() => setTab("telemetry")}>
                Telemetry & Storage
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  await importJson(f);
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
              />
              <Button variant="ghost" className="h-8" onClick={() => fileInputRef.current?.click()}>
                Import JSON
              </Button>
              <Button variant="ghost" className="h-8" onClick={exportJson}>
                Export JSON
              </Button>
              <Button
                className="h-8"
                disabled={!isValid || applyState.status === "sending"}
                title={!isValid ? "Preencha os campos obrigatórios." : "Envia para o backend em /configs (valida e aplica se set_active=true)."}
                onClick={async () => {
                  try {
                    setApplyState({ status: "sending" });
                    const out = await applyToBackend();
                    setApplyState({ status: "ok", msg: out?.id ? `Salvo como ${out.id}` : "Config aplicada" });
                  } catch (err: any) {
                    setApplyState({ status: "error", msg: String(err?.message ?? err) });
                  }
                }}
              >
                Apply to Backend
              </Button>
            </div>
          </div>

          {Object.keys(errors).length > 0 ? (
            <div className="rounded-xl border border-accent-danger/40 bg-accent-danger/10 p-2 text-[11px] text-accent-danger">
              Existem campos obrigatórios faltando/invalidos. Passe o mouse no campo (ou veja borda vermelha).
            </div>
          ) : null}

          {applyState.status !== "idle" ? (
            <div
              className={cn(
                "rounded-xl border p-2 text-[11px]",
                applyState.status === "sending" && "border-border-0/60 bg-bg-2/10 text-fg-1",
                applyState.status === "ok" && "border-accent-ok/40 bg-accent-ok/10 text-accent-ok",
                applyState.status === "error" && "border-accent-danger/40 bg-accent-danger/10 text-accent-danger",
              )}
            >
              {applyState.status === "sending" ? "Enviando para /configs..." : applyState.msg ?? ""}
            </div>
          ) : null}

          {tab === "general" ? (
            <div className="space-y-4">
              {/* Toggle de Modo de Coleta de Dados */}
              <DataModeToggle />

              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Dados Globais</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Identifica a configuração salva em /configs. Usado como id/name.">Experiment Name *</div>
                    <Input className={fieldClass("name")} value={payload.name} onChange={(e) => setPayload((p) => ({ ...p, name: e.target.value }))} />
                  </div>
                  <div className="lg:col-span-2">
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Descrição do objetivo do experimento e contexto.">Description</div>
                    <Input value={payload.description} onChange={(e) => setPayload((p) => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Autor responsável (útil em relatórios e versionamento).">Author *</div>
                    <Input className={fieldClass("author")} value={payload.author} onChange={(e) => setPayload((p) => ({ ...p, author: e.target.value }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Versão do template/configuração (ex: 1.0.0).">Version *</div>
                    <Input className={fieldClass("version")} value={payload.version} onChange={(e) => setPayload((p) => ({ ...p, version: e.target.value }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Modo de execução do ambiente. Deve estar alinhado ao backend.">Environment</div>
                    <Select
                      value={payload.environment}
                      onChange={(e) => {
                        const env = e.target.value as EnvironmentMode;
                        setPayload((p) => ({ ...p, environment: env, config: { ...p.config, environment: { ...p.config.environment, mode: env } } }));
                      }}
                    >
                      <option value="docker">docker</option>
                      <option value="sim">sim</option>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Orquestração</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Controla verbosidade de logs no runtime.">Log Level</div>
                    <Select value={payload.orchestration.log_level} onChange={(e) => setPayload((p) => ({ ...p, orchestration: { ...p.orchestration, log_level: e.target.value as LogLevel } }))}>
                      <option value="info">Info</option>
                      <option value="debug">Debug</option>
                      <option value="error">Error</option>
                    </Select>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Timeout máximo da execução (segundos).">Execution Timeout (s)</div>
                    <Input
                      type="number"
                      min={1}
                      value={payload.orchestration.execution_timeout_sec}
                      onChange={(e) => setPayload((p) => ({ ...p, orchestration: { ...p.orchestration, execution_timeout_sec: Number(e.target.value) } }))}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Purge remove assets temporários; Keep Assets preserva para auditoria/reprodutibilidade.">Cleanup Strategy</div>
                    <Select
                      value={payload.orchestration.cleanup_strategy}
                      onChange={(e) => setPayload((p) => ({ ...p, orchestration: { ...p.orchestration, cleanup_strategy: e.target.value as CleanupStrategy } }))}
                    >
                      <option value="purge">Purge</option>
                      <option value="keep_assets">Keep Assets</option>
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Backend API (Apply)</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div className="lg:col-span-2">
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Base URL da API FastAPI (ex: http://127.0.0.1:8000).">API Base URL *</div>
                    <Input className={fieldClass("backend.api_base_url")} value={payload.backend.api_base_url} onChange={(e) => setPayload((p) => ({ ...p, backend: { ...p.backend, api_base_url: e.target.value } }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Header x-api-key. Se API_KEY estiver vazia no backend, pode ficar em branco.">API Key</div>
                    <Input value={payload.backend.api_key} onChange={(e) => setPayload((p) => ({ ...p, backend: { ...p.backend, api_key: e.target.value } }))} placeholder="opcional" />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-fg-1" title="Se habilitado, envia set_active=true e o backend aplica imediatamente a config.">
                    <input type="checkbox" checked={payload.backend.set_active} onChange={(e) => setPayload((p) => ({ ...p, backend: { ...p.backend, set_active: e.target.checked } }))} />
                    Set Active & Apply
                  </label>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "topology" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Controllers</div>

                {payload.config.controllers.map((c, idx) => (
                  <div key={`${c.id}-${idx}`} className="mb-3 rounded-xl border border-border-0/60 bg-bg-0/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="font-mono text-[11px] text-fg-0">{c.id || `controller_${idx + 1}`}</div>
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        disabled={payload.config.controllers.length <= 1}
                        onClick={() =>
                          setPayload((p) => ({
                            ...p,
                            config: { ...p.config, controllers: p.config.controllers.filter((_, i) => i !== idx) },
                          }))
                        }
                      >
                        Remover
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Identificador único do controlador (referenciado por default_controller e flow_templates).">Controller ID *</div>
                        <Input
                          value={c.id}
                          onChange={(e) =>
                            setPayload((p) => ({
                              ...p,
                              config: {
                                ...p.config,
                                controllers: p.config.controllers.map((cc, i) => (i === idx ? { ...cc, id: e.target.value } : cc)),
                                default_controller: p.config.default_controller === c.id ? e.target.value : p.config.default_controller,
                              },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Tipo aceito pelo backend (ryu/onos/odl/floodlight).">Controller Type</div>
                        <Select
                          value={c.type}
                          onChange={(e) =>
                            setPayload((p) => ({
                              ...p,
                              config: { ...p.config, controllers: p.config.controllers.map((cc, i) => (i === idx ? { ...cc, type: e.target.value as any } : cc)) },
                            }))
                          }
                        >
                          <option value="ryu">Ryu</option>
                          <option value="onos">ONOS</option>
                          <option value="odl">ODL</option>
                          <option value="floodlight">Floodlight</option>
                        </Select>
                      </div>

                      <div className="lg:col-span-2">
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="API REST do controlador (ex: http://127.0.0.1:8080).">Controller API Base URL</div>
                        <Input
                          value={c.api_base_url}
                          onChange={(e) =>
                            setPayload((p) => ({
                              ...p,
                              config: { ...p.config, controllers: p.config.controllers.map((cc, i) => (i === idx ? { ...cc, api_base_url: e.target.value } : cc)) },
                            }))
                          }
                        />
                      </div>

                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Host do OpenFlow (canal de controle).">Controller OF Host</div>
                        <Input
                          value={c.openflow.host}
                          onChange={(e) =>
                            setPayload((p) => ({
                              ...p,
                              config: { ...p.config, controllers: p.config.controllers.map((cc, i) => (i === idx ? { ...cc, openflow: { ...cc.openflow, host: e.target.value } } : cc)) },
                            }))
                          }
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Porta do OpenFlow (ex: 6633/6653).">Controller OF Port</div>
                        <Input
                          type="number"
                          min={1}
                          value={c.openflow.port}
                          onChange={(e) =>
                            setPayload((p) => ({
                              ...p,
                              config: { ...p.config, controllers: p.config.controllers.map((cc, i) => (i === idx ? { ...cc, openflow: { ...cc.openflow, port: Number(e.target.value) } } : cc)) },
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="ghost"
                    className="h-8"
                    onClick={() =>
                      setPayload((p) => ({
                        ...p,
                        config: {
                          ...p.config,
                          controllers: [
                            ...p.config.controllers,
                            {
                              id: `ctrl-${p.config.controllers.length + 1}`,
                              type: "ryu",
                              api_base_url: "http://127.0.0.1:8080",
                              openflow: { host: "127.0.0.1", port: 6633 },
                              auth: { mode: "none", token: null, username: null, password: null },
                            },
                          ],
                        },
                      }))
                    }
                  >
                    Adicionar Controller
                  </Button>

                  <div className="w-full max-w-[320px]">
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Controller padrão referenciado pelo topo/flows.">Default Controller</div>
                    <Select
                      className={fieldClass("config.default_controller")}
                      value={payload.config.default_controller ?? ""}
                      onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, default_controller: e.target.value } }))}
                    >
                      {payload.config.controllers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.id}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Nodes</div>
                <div className={cn("mb-2 rounded-lg border bg-bg-0/40 p-2 text-[11px]", errors["config.nodes.unique"] ? "border-accent-danger/50 text-accent-danger" : "border-border-0/60 text-fg-1")}>
                  {errors["config.nodes.unique"] ? errors["config.nodes.unique"] : "IDs devem ser únicos (ex: c1, s1, h1)."}
                </div>

                {payload.config.nodes.map((n, idx) => (
                  <div key={`${n.id}-${idx}`} className="mb-3 rounded-xl border border-border-0/60 bg-bg-0/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="font-mono text-[11px] text-fg-0">{n.id || `node_${idx + 1}`}</div>
                      <Button
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        disabled={payload.config.nodes.length <= 1}
                        onClick={() => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.filter((_, i) => i !== idx) } }))}
                      >
                        Remover
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="ID único do nó (usado em links e tráfego).">Node ID *</div>
                        <Input
                          className={fieldClass("config.nodes")}
                          value={n.id}
                          onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, id: e.target.value } : nn)) } }))}
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Papel do nó. Backend aceita host/switch/controller.">Role</div>
                        <Select value={n.role} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, role: e.target.value as any } : nn)) } }))}>
                          <option value="controller">controller</option>
                          <option value="switch">switch</option>
                          <option value="host">host</option>
                        </Select>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="IP de gerenciamento do container/nó.">Mgmt IP</div>
                        <Input value={n.mgmt_ip ?? ""} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, mgmt_ip: e.target.value } : nn)) } }))} />
                      </div>
                      <div className="lg:col-span-2">
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Imagem Docker/LST usada para instanciar o nó.">Image Name</div>
                        <Input value={n.image ?? ""} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, image: e.target.value } : nn)) } }))} />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Nome do container (opcional, mas útil para depuração).">Container Name</div>
                        <Input value={n.container_name ?? ""} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, container_name: e.target.value } : nn)) } }))} />
                      </div>

                      {n.role === "switch" ? (
                        <>
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-fg-1" title="OVS ou switch user-space.">Switch Type</div>
                            <Select value={n.type ?? "ovs"} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, type: e.target.value as any } : nn)) } }))}>
                              <option value="ovs">OVS</option>
                              <option value="user">User</option>
                            </Select>
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-fg-1" title="Versão OpenFlow (armazenado em node.meta.openflow_version).">OpenFlow Version</div>
                            <Input
                              value={String(n.meta.openflow_version ?? "")}
                              onChange={(e) =>
                                setPayload((p) => ({
                                  ...p,
                                  config: {
                                    ...p.config,
                                    nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, meta: { ...nn.meta, openflow_version: e.target.value } } : nn)),
                                  },
                                }))
                              }
                              placeholder="ex: 1.3"
                            />
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-fg-1" title="Bridge do OVS (ex: br-s1).">Bridge</div>
                            <Input value={n.bridge ?? ""} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, bridge: e.target.value } : nn)) } }))} />
                          </div>
                          <div>
                            <div className="mb-1 text-[11px] font-medium text-fg-1" title="DPID do switch em hexadecimal (16 dígitos).">DPID</div>
                            <Input
                              value={n.datapath_id ?? ""}
                              onChange={(e) =>
                                setPayload((p) => ({
                                  ...p,
                                  config: { ...p.config, nodes: p.config.nodes.map((nn, i) => (i === idx ? { ...nn, datapath_id: normalizeDpId(e.target.value) } : nn)) },
                                }))
                              }
                            />
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}

                <Button
                  variant="ghost"
                  className="h-8"
                  onClick={() =>
                    setPayload((p) => ({
                      ...p,
                      config: {
                        ...p.config,
                        nodes: [
                          ...p.config.nodes,
                          { id: `h${p.config.nodes.length + 1}`, role: "host", mgmt_ip: "", image: "", container_name: "", meta: {} },
                        ],
                      },
                    }))
                  }
                >
                  Adicionar Node
                </Button>
              </div>

              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Links</div>
                {payload.config.links.map((l, idx) => (
                  <div key={`${l.source}-${l.target}-${idx}`} className={cn("mb-3 rounded-xl border bg-bg-0/40 p-3", errors[`config.links[${idx}]`] ? "border-accent-danger/50" : "border-border-0/60")}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="font-mono text-[11px] text-fg-0">{l.source} → {l.target}</div>
                      <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setPayload((p) => ({ ...p, config: { ...p.config, links: p.config.links.filter((_, i) => i !== idx) } }))}>
                        Remover
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
                      <div className="lg:col-span-1">
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Nó de origem (deve existir em nodes).">Source</div>
                        <Select value={l.source} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, links: p.config.links.map((ll, i) => (i === idx ? { ...ll, source: e.target.value } : ll)) } }))}>
                          {payload.config.nodes.map((n) => (
                            <option key={n.id} value={n.id}>{n.id}</option>
                          ))}
                        </Select>
                      </div>
                      <div className="lg:col-span-1">
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Nó de destino (deve existir em nodes).">Target</div>
                        <Select value={l.target} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, links: p.config.links.map((ll, i) => (i === idx ? { ...ll, target: e.target.value } : ll)) } }))}>
                          {payload.config.nodes.map((n) => (
                            <option key={n.id} value={n.id}>{n.id}</option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Largura de banda (Mbps).">Bandwidth</div>
                        <Input type="number" min={0} value={l.bandwidth_mbps ?? 0} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, links: p.config.links.map((ll, i) => (i === idx ? { ...ll, bandwidth_mbps: Number(e.target.value) } : ll)) } }))} />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Atraso (ms).">Delay</div>
                        <Input type="number" min={0} value={l.delay_ms ?? 0} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, links: p.config.links.map((ll, i) => (i === idx ? { ...ll, delay_ms: Number(e.target.value) } : ll)) } }))} />
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Perda (%).">Loss</div>
                        <Input type="number" min={0} step={0.1} value={l.loss_pct ?? 0} onChange={(e) => setPayload((p) => ({ ...p, config: { ...p.config, links: p.config.links.map((ll, i) => (i === idx ? { ...ll, loss_pct: Number(e.target.value) } : ll)) } }))} />
                      </div>
                      <div className="lg:col-span-2">
                        <div className="mb-1 text-[11px] font-medium text-fg-1" title="Max Queue Size (armazenado em link.meta.max_queue_size).">Max Queue Size</div>
                        <Input
                          type="number"
                          min={0}
                          value={l.meta?.max_queue_size ?? 0}
                          onChange={(e) =>
                            setPayload((p) => ({
                              ...p,
                              config: {
                                ...p.config,
                                links: p.config.links.map((ll, i) =>
                                  i === idx ? { ...ll, meta: { ...(ll.meta ?? {}), max_queue_size: Number(e.target.value) } } : ll,
                                ),
                              },
                            }))
                          }
                        />
                      </div>
                    </div>
                    {errors[`config.links[${idx}]`] ? <div className="mt-2 text-[11px] text-accent-danger">{errors[`config.links[${idx}]`]}</div> : null}
                  </div>
                ))}

                <Button
                  variant="ghost"
                  className="h-8"
                  onClick={() =>
                    setPayload((p) => ({
                      ...p,
                      config: {
                        ...p.config,
                        links: [
                          ...p.config.links,
                          { source: p.config.nodes[0]?.id ?? "", target: p.config.nodes[1]?.id ?? p.config.nodes[0]?.id ?? "", bandwidth_mbps: 1000, delay_ms: 1, loss_pct: 0, meta: { max_queue_size: 0 } },
                        ],
                      },
                    }))
                  }
                >
                  Adicionar Link
                </Button>
              </div>
            </div>
          ) : null}

          {tab === "resources" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold text-fg-0">Recursos por Nó</div>
                    <div className="mt-0.5 text-[11px] text-fg-1">CPU/Mem/ENV/Mounts são armazenados em <span className="font-mono">node.meta</span> (compatível com o backend).</div>
                  </div>
                  <div className="w-full max-w-[260px]">
                    <Select value={nodeForResources} onChange={(e) => setNodeForResources(e.target.value)}>
                      {payload.config.nodes.map((n) => (
                        <option key={n.id} value={n.id}>{n.id} · {n.role}</option>
                      ))}
                    </Select>
                  </div>
                </div>

                {!selectedNode ? (
                  <div className="text-[11px] text-fg-1">Nenhum nó selecionado.</div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1" title="Limite de CPU (ex: 0.5, 1, 2).">CPU Limit</div>
                      <Input
                        value={String(selectedNode.meta.cpu_limit ?? "")}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            config: {
                              ...p.config,
                              nodes: p.config.nodes.map((n) => (n.id === selectedNode.id ? { ...n, meta: { ...n.meta, cpu_limit: e.target.value } } : n)),
                            },
                          }))
                        }
                        placeholder="ex: 1"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[11px] font-medium text-fg-1" title="Limite de memória (ex: 512m, 1g).">Memory Limit</div>
                      <Input
                        value={String(selectedNode.meta.memory_limit ?? "")}
                        onChange={(e) =>
                          setPayload((p) => ({
                            ...p,
                            config: {
                              ...p.config,
                              nodes: p.config.nodes.map((n) => (n.id === selectedNode.id ? { ...n, meta: { ...n.meta, memory_limit: e.target.value } } : n)),
                            },
                          }))
                        }
                        placeholder="ex: 1g"
                      />
                    </div>

                    <div className="lg:col-span-2">
                      <div className="mb-1 text-[11px] font-medium text-fg-1" title="Environment Variables (KEY=VALUE por linha).">Environment Variables</div>
                      <textarea
                        className={cn(
                          "min-h-[96px] w-full rounded-lg border border-border-0/60 bg-bg-2/40 px-2 py-2 font-mono text-[11px] text-fg-0",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ok/40",
                        )}
                        value={formatKvLines(selectedNode.meta.env)}
                        onChange={(e) => {
                          const env = parseKvLines(e.target.value);
                          setPayload((p) => ({
                            ...p,
                            config: {
                              ...p.config,
                              nodes: p.config.nodes.map((n) => (n.id === selectedNode.id ? { ...n, meta: { ...n.meta, env } } : n)),
                            },
                          }));
                        }}
                        placeholder="EXAMPLE=1\nLOG_LEVEL=info"
                      />
                    </div>

                    <div className="lg:col-span-2">
                      <div className="mb-1 text-[11px] font-medium text-fg-1" title="Mounts (source:target:mode). Um por linha; modo ro/rw.">Volumes / Mounts</div>
                      <textarea
                        className={cn(
                          "min-h-[96px] w-full rounded-lg border border-border-0/60 bg-bg-2/40 px-2 py-2 font-mono text-[11px] text-fg-0",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ok/40",
                        )}
                        value={(selectedNode.meta.mounts ?? []).map((m) => `${m.source}:${m.target}:${m.mode ?? "rw"}`).join("\n")}
                        onChange={(e) => {
                          const mounts = (e.target.value ?? "")
                            .split(/\r?\n/)
                            .map((l) => l.trim())
                            .filter(Boolean)
                            .map((l) => {
                              const [source, target, mode] = l.split(":");
                              const parsedMode = mode === "ro" ? ("ro" as const) : ("rw" as const);
                              return { source: source ?? "", target: target ?? "", mode: parsedMode };
                            })
                            .filter((m) => m.source && m.target);
                          setPayload((p) => ({
                            ...p,
                            config: {
                              ...p.config,
                              nodes: p.config.nodes.map((n) => (n.id === selectedNode.id ? { ...n, meta: { ...n.meta, mounts } } : n)),
                            },
                          }));
                        }}
                        placeholder="/host/path:/container/path:ro"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {tab === "telemetry" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Telemetria & Storage</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Endpoint de telemetria/ingestão. Útil para clientes e pipelines de pesquisa.">Endpoint URL</div>
                    <Input value={payload.telemetry.endpoint_url} onChange={(e) => setPayload((p) => ({ ...p, telemetry: { ...p.telemetry, endpoint_url: e.target.value } }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Nome lógico do banco/dataset.">Database Name</div>
                    <Input value={payload.telemetry.database_name} onChange={(e) => setPayload((p) => ({ ...p, telemetry: { ...p.telemetry, database_name: e.target.value } }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Batch size de envio de amostras para reduzir overhead.">Batch Size</div>
                    <Input type="number" min={1} value={payload.telemetry.batch_size} onChange={(e) => setPayload((p) => ({ ...p, telemetry: { ...p.telemetry, batch_size: Number(e.target.value) } }))} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Intervalo de coleta em ms. Também ajusta metric_plan.interval_sec.">Sampling Rate (ms)</div>
                    <Input
                      type="number"
                      min={50}
                      value={payload.telemetry.sampling_rate_ms}
                      onChange={(e) => {
                        const ms = Number(e.target.value);
                        setPayload((p) => ({
                          ...p,
                          telemetry: { ...p.telemetry, sampling_rate_ms: ms },
                          config: {
                            ...p.config,
                            metric_plan: p.config.metric_plan
                              ? { ...p.config.metric_plan, interval_sec: Math.max(0.05, ms / 1000) }
                              : { metrics: ["latency_ms"], interval_sec: Math.max(0.05, ms / 1000), labels: ["experiment_id", "run_id", "topology_id"] },
                          },
                        }));
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-3">
                <div className="mb-2 text-[11px] font-semibold text-fg-0">Metric Plan (backend)</div>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="lg:col-span-2">
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Lista de métricas (separadas por vírgula). O backend valida que exista ao menos 1.">Metrics *</div>
                    <Input
                      className={fieldClass("config.metric_plan.metrics")}
                      value={(payload.config.metric_plan?.metrics ?? []).join(", ")}
                      onChange={(e) => {
                        const metrics = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        setPayload((p) => ({
                          ...p,
                          config: {
                            ...p.config,
                            metric_plan: p.config.metric_plan
                              ? { ...p.config.metric_plan, metrics }
                              : { metrics, interval_sec: 5, labels: ["experiment_id", "run_id", "topology_id"] },
                          },
                        }));
                      }}
                      placeholder="latency_ms, packet_loss_pct, throughput_mbps"
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Intervalo em segundos (backend usa interval_sec).">Interval (sec)</div>
                    <Input
                      className={fieldClass("config.metric_plan.interval_sec")}
                      type="number"
                      min={0.05}
                      step={0.05}
                      value={payload.config.metric_plan?.interval_sec ?? 5}
                      onChange={(e) => {
                        const sec = Number(e.target.value);
                        setPayload((p) => ({
                          ...p,
                          config: {
                            ...p.config,
                            metric_plan: p.config.metric_plan
                              ? { ...p.config.metric_plan, interval_sec: sec }
                              : { metrics: ["latency_ms"], interval_sec: sec, labels: ["experiment_id", "run_id", "topology_id"] },
                          },
                        }));
                      }}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-medium text-fg-1" title="Labels adicionadas às séries/records.">Labels</div>
                    <Input
                      value={(payload.config.metric_plan?.labels ?? []).join(", ")}
                      onChange={(e) => {
                        const labels = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        setPayload((p) => ({
                          ...p,
                          config: {
                            ...p.config,
                            metric_plan: p.config.metric_plan
                              ? { ...p.config.metric_plan, labels }
                              : { metrics: ["latency_ms"], interval_sec: 5, labels },
                          },
                        }));
                      }}
                      placeholder="experiment_id, run_id, topology_id"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Preview do JSON (tempo real)"
          right={<span className={cn("font-mono text-[11px]", isValid ? "text-accent-ok" : "text-accent-danger")}>{isValid ? "válido" : "inválido"}</span>}
        />
        <CardBody className="space-y-2">
          {/* ── Configs salvas no back-end ─────────────────────────── */}
          <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[11px] font-semibold text-fg-0">Configs salvas no back-end</div>
              <Button
                variant="ghost"
                className="h-7 px-2 text-[10px]"
                disabled={savedConfigsLoading}
                onClick={reloadSavedConfigs}
              >
                {savedConfigsLoading ? "…" : "↺ Atualizar"}
              </Button>
            </div>
            {savedConfigs.length === 0 ? (
              <div className="text-[11px] text-fg-1">Nenhuma config encontrada (ou back-end offline).</div>
            ) : (
              <div className="space-y-1">
                {savedConfigs.map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 rounded-md border border-border-0/50 bg-bg-1/30 px-2 py-1.5">
                    <div className="min-w-0">
                      <span className="font-mono text-[11px] text-fg-0">{c.name}</span>
                      {c.active && (
                        <span className="ml-2 rounded-md bg-accent-ok/20 px-1.5 py-0.5 text-[10px] font-medium text-accent-ok">
                          ativo
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => loadConfigFromBackend(c.id)}>
                        Carregar
                      </Button>
                      {!c.active && (
                        <Button variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => activateConfigOnBackend(c.id)}>
                          Ativar
                        </Button>
                      )}
                      <Button variant="ghost" className="h-6 px-2 text-[10px] text-accent-danger/80 hover:text-accent-danger" onClick={() => deleteConfigOnBackend(c.id)}>
                        ×
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border-0/60 bg-bg-2/10 p-2">
            <pre
              className={cn(
                "max-h-[70vh] overflow-auto whitespace-pre rounded-lg bg-bg-0/30 p-2 font-mono text-[11px]",
              )}
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </div>

          <div className="text-[11px] text-fg-1">
            Dica: o backend valida o campo <span className="font-mono">config</span> em <span className="font-mono">POST /configs</span>.
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

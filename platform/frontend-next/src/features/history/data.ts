export type AuditRow = {
  id: string;
  ts: string;
  actor: string;
  module: "experimentos" | "topologia" | "lab" | "monitor" | "config";
  severity: "Normal" | "Emergência";
  experimentId?: string;
  summary: string;
  log: Record<string, unknown>;
  results: Record<string, unknown>;
};

export const auditRows: AuditRow[] = Array.from({ length: 22 }).map((_, i) => {
  const id = `evt-${String(i + 1).padStart(4, "0")}`;
  const severity = Math.random() < 0.15 ? "Emergência" : "Normal";
  const modulePool: AuditRow["module"][] = ["experimentos", "topologia", "lab", "monitor", "config"];
  const moduleKey = modulePool[i % modulePool.length];
  const ts = new Date(Date.now() - i * 1000 * 60 * 13).toISOString();
  const experimentId = moduleKey === "experimentos" ? `exp-${String(100 + i)}` : undefined;

  return {
    id,
    ts,
    actor: i % 2 === 0 ? "researcher" : "system",
    module: moduleKey,
    severity,
    experimentId,
    summary:
      moduleKey === "experimentos"
        ? `Execução ${experimentId} concluída (telemetria ok)`
        : moduleKey === "config"
          ? "Auto-discovery executado"
          : moduleKey === "topologia"
            ? "Nó atualizado (propriedades)"
            : moduleKey === "lab"
              ? "Fluxo recompilado"
              : "Evento de monitor (stream)",
    log: {
      id,
      ts,
      module: moduleKey,
      severity,
      experimentId,
      payload: {
        switch_id: `s${(i % 8) + 1}`,
        layer: ["L0", "L1", "L2", "L3"][i % 4],
        notes: "synthetic audit entry",
      },
    },
    results: {
      metrics: {
        latency_ms_p95: Number((10 + Math.random() * 60).toFixed(2)),
        jitter_ms_p95: Number((1 + Math.random() * 12).toFixed(2)),
        loss_pct: Number((Math.random() * 4).toFixed(3)),
        throughput_mbps_avg: Number((100 + Math.random() * 1200).toFixed(1)),
      },
      artifacts: {
        jsonl: ["metrics_session.jsonl", "metrics_network.jsonl"],
      },
    },
  };
});

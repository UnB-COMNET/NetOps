export type TrafficType = "TCP" | "UDP" | "ICMP" | "HTTP" | "gRPC";

export type RateUnit = "pps" | "Mbps";

export type ManualExperimentConfig = {
  general: {
    name: string;
    scientificDescription: string;
    durationS: number;
    samplingMs: number;
    repeatCount?: number; // Número de vezes para repetir o experimento
  };
  traffic: {
    srcHostId: string;
    dstHostId: string;
    type: TrafficType;
    rateValue: number;
    rateUnit: RateUnit;
  };
  telemetry: {
    metricKeys: string[];
  };
  scripts: {
    pre: string;
    post: string;
  };
};

export type ExperimentTemplate = {
  id: string;
  name: string;
  description: string;
  monitoredLayers: Array<"L0" | "L1" | "L2" | "L3" | "L4" | "L5" | "L6" | "L7">;
  requiredTopology: {
    hosts: number;
    switches: number;
    controllers: number;
  };
  params: ManualExperimentConfig;
};

export const templates: ExperimentTemplate[] = [
  {
    id: "ddos_attack_sim",
    name: "DDoS Attack Simulation",
    description: "Simula saturação com tráfego volumétrico e bursts para avaliar impacto por camadas.",
    monitoredLayers: ["L1", "L2", "L3", "L4"],
    requiredTopology: { hosts: 6, switches: 2, controllers: 1 },
    params: {
      general: {
        name: "DDoS Attack Simulation",
        scientificDescription: "Avaliar degradação de serviço sob aumento abrupto de pps (L2/L3/L4).",
        durationS: 120,
        samplingMs: 250,
      },
      traffic: {
        srcHostId: "Host-A",
        dstHostId: "Host-D",
        type: "UDP",
        rateValue: 45000,
        rateUnit: "pps",
      },
      telemetry: {
        metricKeys: [
          "port_rx_bps",
          "port_tx_bps",
          "link_util_pct",
          "port_rx_drops",
          "ipv4_forward_drops",
          "udp_loss_pct",
          "throughput_mbps",
          "tcp_retrans_pct",
        ],
      },
      scripts: {
        pre: "# Exemplo: preparar regras/rotas antes da execução\n",
        post: "# Exemplo: coletar artefatos e limpar estado\n",
      },
    },
  },
  {
    id: "link_failure_recovery",
    name: "Link Failure Recovery",
    description: "Força falha de link e observa convergência e recuperação de conectividade.",
    monitoredLayers: ["L0", "L1", "L2", "L3"],
    requiredTopology: { hosts: 4, switches: 2, controllers: 1 },
    params: {
      general: {
        name: "Link Failure Recovery",
        scientificDescription: "Medir tempo de detecção e recuperação após falha de link no caminho principal.",
        durationS: 90,
        samplingMs: 200,
      },
      traffic: {
        srcHostId: "Host-A",
        dstHostId: "Host-C",
        type: "ICMP",
        rateValue: 50,
        rateUnit: "pps",
      },
      telemetry: {
        metricKeys: [
          "if_link_up",
          "lldp_neighbors",
          "stp_topology_changes",
          "port_rx_bps",
          "port_tx_bps",
          "icmp_unreach_total",
        ],
      },
      scripts: {
        pre: "# Exemplo: derrubar link em t=30s\n# cmd: link set Switch-01:eth2 down\n",
        post: "# Exemplo: restaurar link e exportar logs\n",
      },
    },
  },
  {
    id: "tcp_congestion_test",
    name: "TCP Congestion Test",
    description: "Gera tráfego TCP para observar retransmissões, throughput e latência de aplicação.",
    monitoredLayers: ["L1", "L3", "L4", "L7"],
    requiredTopology: { hosts: 4, switches: 2, controllers: 1 },
    params: {
      general: {
        name: "TCP Congestion Test",
        scientificDescription: "Quantificar retransmissões TCP e efeitos no throughput sob carga (L3/L4/L7).",
        durationS: 180,
        samplingMs: 300,
      },
      traffic: {
        srcHostId: "Host-B",
        dstHostId: "Host-D",
        type: "TCP",
        rateValue: 600,
        rateUnit: "Mbps",
      },
      telemetry: {
        metricKeys: [
          "tcp_retrans_pct",
          "tcp_rtt_ms",
          "throughput_mbps",
          "port_tx_bps",
          "link_util_pct",
          "app_latency_ms_p95",
        ],
      },
      scripts: {
        pre: "# Exemplo: iniciar servidor iperf/http no destino\n",
        post: "# Exemplo: parar processos e coletar pcaps\n",
      },
    },
  },
];

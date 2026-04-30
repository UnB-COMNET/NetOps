"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
} from "reactflow";
import "reactflow/dist/style.css";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { nodeTypes } from "@/features/topology/nodeTypes";
import { edgeTypes, type LinkStatus } from "@/features/topology/edgeTypes";
import { cn } from "@/lib/cn";
import { topologyApi, metricsApi, type Topology as ApiTopology, type MetricSample } from "@/lib/api"
import { useTopologyMutations } from "@/hooks/useTopology";

type NodeKind = "switch" | "host" | "controller";
type MapMode = "logical" | "physical";

type SwitchPort = { portNo: number; name: string; rxPkts: number; txPkts: number; errors: number };
type FlowRow = { table: number; priority: number; match: string; actions: string; packets: number; bytes: number };

type HostArpRow = { ip: string; mac: string; iface: string; state: "REACHABLE" | "STALE" | "FAILED" };
type HostSocketRow = { proto: "tcp" | "udp"; local: string; remote: string; state: string; pid: number; proc: string };
type IfaceStats = { iface: string; rxMbps: number; txMbps: number; rxDrops: number; txDrops: number; errors: number };

type TopologyNodeData = {
  id: string;
  dpid?: string;
  mgmtIp?: string;
  ip?: string;
  mac?: string;
  iface?: string;
  gateway?: string;

  // Controller-only
  status?: "online" | "offline";
  responseLatencyMs?: number;

  // Switch-only technical fields
  ports?: SwitchPort[];
  flowTables?: FlowRow[];
  pktStats?: { rxPps: number; txPps: number; dropPps: number };

  // Host-only technical fields
  arpTable?: HostArpRow[];
  sockets?: HostSocketRow[];
  ifaceStats?: IfaceStats;
  cpuPct?: number;
  memPct?: number;
};

const initialNodes: Node<TopologyNodeData>[] = [
  {
    id: "Controller-01",
    type: "controller",
    position: { x: 60, y: 40 },
    data: {
      id: "Controller-01",
      mgmtIp: "10.0.0.10",
      status: "online",
      responseLatencyMs: 7.8,
    },
  },
  {
    id: "Switch-01",
    type: "switch",
    position: { x: 120, y: 200 },
    data: {
      id: "Switch-01",
      dpid: "0000000000000001",
      mgmtIp: "10.0.0.1",
      ports: [
        { portNo: 1, name: "s1-eth1", rxPkts: 120340, txPkts: 110120, errors: 0 },
        { portNo: 2, name: "s1-eth2", rxPkts: 90340, txPkts: 100420, errors: 2 },
        { portNo: 3, name: "s1-eth3", rxPkts: 40210, txPkts: 30100, errors: 0 },
      ],
      flowTables: [
        { table: 0, priority: 100, match: "ip,nw_dst=10.0.0.0/24", actions: "output:1", packets: 92310, bytes: 91200340 },
        { table: 0, priority: 10, match: "arp", actions: "flood", packets: 1200, bytes: 220340 },
        { table: 1, priority: 50, match: "tcp,tp_dst=80", actions: "meter:1,output:2", packets: 8021, bytes: 14022340 },
      ],
      pktStats: { rxPps: 820, txPps: 780, dropPps: 4 },
    },
  },
  {
    id: "Switch-02",
    type: "switch",
    position: { x: 420, y: 220 },
    data: {
      id: "Switch-02",
      dpid: "0000000000000002",
      mgmtIp: "10.0.0.2",
      ports: [
        { portNo: 1, name: "s2-eth1", rxPkts: 60340, txPkts: 90420, errors: 0 },
        { portNo: 2, name: "s2-eth2", rxPkts: 40340, txPkts: 30420, errors: 0 },
        { portNo: 3, name: "s2-eth3", rxPkts: 12010, txPkts: 18100, errors: 1 },
      ],
      flowTables: [
        { table: 0, priority: 200, match: "ip,nw_dst=10.0.0.0/24", actions: "output:1", packets: 42310, bytes: 21200340 },
        { table: 0, priority: 10, match: "arp", actions: "flood", packets: 820, bytes: 160340 },
        { table: 1, priority: 50, match: "tcp,tp_dst=443", actions: "meter:2,output:2", packets: 5021, bytes: 9022340 },
      ],
      pktStats: { rxPps: 640, txPps: 610, dropPps: 2 },
    },
  },
  {
    id: "Host-A",
    type: "host",
    position: { x: 60, y: 340 },
    data: {
      id: "Host-A",
      ip: "10.0.0.101",
      mac: "aa:bb:cc:dd:ee:01",
      iface: "eth0",
      gateway: "10.0.0.1",
    },
  },
  {
    id: "Host-B",
    type: "host",
    position: { x: 220, y: 360 },
    data: {
      id: "Host-B",
      ip: "10.0.0.102",
      mac: "aa:bb:cc:dd:ee:02",
      iface: "eth0",
      gateway: "10.0.0.1",
    },
  },
  {
    id: "Host-C",
    type: "host",
    position: { x: 520, y: 360 },
    data: {
      id: "Host-C",
      ip: "10.0.0.201",
      mac: "aa:bb:cc:dd:ee:03",
      iface: "eth0",
      gateway: "10.0.0.2",
    },
  },
  {
    id: "Host-D",
    type: "host",
    position: { x: 700, y: 340 },
    data: {
      id: "Host-D",
      ip: "10.0.0.202",
      mac: "aa:bb:cc:dd:ee:04",
      iface: "eth0",
      gateway: "10.0.0.2",
    },
  },
];

const initialEdgesPhysical: Edge<LinkStatus>[] = [
  {
    id: "p-ctrl-s1",
    source: "Controller-01",
    target: "Switch-01",
    type: "util",
    animated: false,
    data: { mode: "physical", utilPct: 12, capacityMbps: 1000, lossPct: 0.0, up: true },
  },
  {
    id: "p-ctrl-s2",
    source: "Controller-01",
    target: "Switch-02",
    type: "util",
    animated: false,
    data: { mode: "physical", utilPct: 9, capacityMbps: 1000, lossPct: 0.1, up: true },
  },
  {
    id: "p-s1-s2",
    source: "Switch-01",
    target: "Switch-02",
    type: "util",
    animated: true,
    data: { mode: "physical", utilPct: 71, capacityMbps: 10000, lossPct: 4.2, up: true },
  },
  {
    id: "p-s1-ha",
    source: "Switch-01",
    target: "Host-A",
    type: "util",
    animated: false,
    data: { mode: "physical", utilPct: 42, capacityMbps: 1000, lossPct: 0.1, up: true },
  },
  {
    id: "p-s1-hb",
    source: "Switch-01",
    target: "Host-B",
    type: "util",
    animated: true,
    data: { mode: "physical", utilPct: 0.0, capacityMbps: 1000, lossPct: 0.0, up: false },
  },
  {
    id: "p-s2-hc",
    source: "Switch-02",
    target: "Host-C",
    type: "util",
    animated: false,
    data: { mode: "physical", utilPct: 23, capacityMbps: 1000, lossPct: 0.3, up: true },
  },
  {
    id: "p-s2-hd",
    source: "Switch-02",
    target: "Host-D",
    type: "util",
    animated: false,
    data: { mode: "physical", utilPct: 28, capacityMbps: 1000, lossPct: 0.2, up: true },
  },
];

const initialEdgesLogical: Edge<LinkStatus>[] = [
  {
    id: "l-ctrl-s1",
    source: "Controller-01",
    target: "Switch-01",
    type: "util",
    animated: false,
    data: { mode: "logical", up: true, lossPct: 0 },
  },
  {
    id: "l-ctrl-s2",
    source: "Controller-01",
    target: "Switch-02",
    type: "util",
    animated: false,
    data: { mode: "logical", up: true, lossPct: 0 },
  },
  {
    id: "l-s1-s2",
    source: "Switch-01",
    target: "Switch-02",
    type: "util",
    animated: false,
    data: { mode: "logical", up: true, lossPct: 0 },
  },
  {
    id: "l-s1-ha",
    source: "Switch-01",
    target: "Host-A",
    type: "util",
    animated: false,
    data: { mode: "logical", up: true, lossPct: 0 },
  },
  {
    id: "l-s1-hb",
    source: "Switch-01",
    target: "Host-B",
    type: "util",
    animated: false,
    data: { mode: "logical", up: true, lossPct: 0 },
  },
  {
    id: "l-s2-hc",
    source: "Switch-02",
    target: "Host-C",
    type: "util",
    animated: false,
    data: { mode: "logical", up: true, lossPct: 0 },
  },
  {
    id: "l-s2-hd",
    source: "Switch-02",
    target: "Host-D",
    type: "util",
    animated: false,
    data: { mode: "logical", up: true, lossPct: 0 },
  },
];

function synthArpTable(hostId: string): HostArpRow[] {
  const rows: HostArpRow[] = [
    { ip: "10.0.0.1", mac: "00:00:00:00:00:01", iface: "eth0", state: "REACHABLE" },
    { ip: "10.0.0.2", mac: "00:00:00:00:00:02", iface: "eth0", state: Math.random() < 0.15 ? "STALE" : "REACHABLE" },
    { ip: "10.0.0.254", mac: "00:00:00:00:fe:01", iface: "eth0", state: "REACHABLE" },
    { ip: "10.0.0.250", mac: "00:00:00:00:fa:01", iface: "eth0", state: "FAILED" },
  ];
  return rows.map((r) => ({ ...r, iface: `${hostId}-eth0` }));
}

function synthSockets(): HostSocketRow[] {
  return [
    { proto: "tcp", local: "10.0.0.101:55210", remote: "10.0.0.20:443", state: "ESTAB", pid: 2310, proc: "curl" },
    { proto: "tcp", local: "10.0.0.101:55212", remote: "10.0.0.30:80", state: "ESTAB", pid: 1221, proc: "python" },
    { proto: "udp", local: "10.0.0.101:53021", remote: "10.0.0.53:53", state: "UNCONN", pid: 830, proc: "systemd" },
    { proto: "tcp", local: "10.0.0.101:22", remote: "—", state: "LISTEN", pid: 640, proc: "sshd" },
  ];
}

function synthIfaceStats(hostId: string): IfaceStats {
  return {
    iface: `${hostId}-eth0`,
    rxMbps: 120,
    txMbps: 95,
    rxDrops: 0,
    txDrops: 0,
    errors: 0,
  };
}

type SelectedElement =
  | { kind: "node"; nodeId: string }
  | { kind: "edge"; edgeId: string }
  | null;

type TopologySnapshot = {
  capturedAt: string;
  mode: MapMode;
  nodes: Node<TopologyNodeData>[];
  edgesPhysical: Edge<LinkStatus>[];
  edgesLogical: Edge<LinkStatus>[];
};

function readSnapshotsFromStorage(): TopologySnapshot[] {
  try {
    const raw = localStorage.getItem("netops.topology.snapshots");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TopologySnapshot[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function summarizeSnapshotDiff(a: TopologySnapshot, b: TopologySnapshot) {
  const aNodeIds = new Set(a.nodes.map((n) => n.id));
  const bNodeIds = new Set(b.nodes.map((n) => n.id));

  let nodesAdded = 0;
  let nodesRemoved = 0;
  for (const id of bNodeIds) if (!aNodeIds.has(id)) nodesAdded++;
  for (const id of aNodeIds) if (!bNodeIds.has(id)) nodesRemoved++;

  const aNodeMap = new Map(a.nodes.map((n) => [n.id, n] as const));
  const bNodeMap = new Map(b.nodes.map((n) => [n.id, n] as const));
  let nodesMoved = 0;
  for (const id of aNodeIds) {
    const an = aNodeMap.get(id);
    const bn = bNodeMap.get(id);
    if (!an || !bn) continue;
    const dx = (an.position?.x ?? 0) - (bn.position?.x ?? 0);
    const dy = (an.position?.y ?? 0) - (bn.position?.y ?? 0);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 3) nodesMoved++;
  }

  const aPhysDown = (a.edgesPhysical ?? []).filter((e) => (e.data?.up ?? true) === false).length;
  const bPhysDown = (b.edgesPhysical ?? []).filter((e) => (e.data?.up ?? true) === false).length;
  const aPhysDanger = (a.edgesPhysical ?? []).filter((e) => (e.data?.lossPct ?? 0) >= 2.5).length;
  const bPhysDanger = (b.edgesPhysical ?? []).filter((e) => (e.data?.lossPct ?? 0) >= 2.5).length;

  return {
    nodesAdded,
    nodesRemoved,
    nodesMoved,
    physDownDelta: bPhysDown - aPhysDown,
    physDangerDelta: bPhysDanger - aPhysDanger,
  };
}

type ScenarioId = "base" | "all-ok" | "degraded" | "down" | "trace";

type ScenarioSpec = {
  id: ScenarioId;
  title: string;
  subtitle: string;
  apply: () => {
    mode: MapMode;
    nodes: Node<TopologyNodeData>[];
    edgesPhysical: Edge<LinkStatus>[];
    edgesLogical: Edge<LinkStatus>[];
    traceFrom?: string;
    traceTo?: string;
  };
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function markTraceEdges(edges: Edge<LinkStatus>[], pairs: Array<[string, string]>) {
  return edges.map((e) => {
    const hit = pairs.some(([a, b]) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
    if (!hit) return { ...e, data: { ...(e.data ?? ({ mode: "physical" } as LinkStatus)), trace: false }, animated: (e.data?.lossPct ?? 0) >= 2.5 || (e.data?.up ?? true) === false };
    return {
      ...e,
      animated: true,
      data: { ...(e.data ?? ({ mode: "physical" } as LinkStatus)), trace: true },
    };
  });
}

type HostDraft = {
  name: string;
  ip: string;
  mac: string;
  iface: string;
  gateway: string;
};

function nextId(prefix: string, used: Set<string>) {
  for (let i = 1; i < 9999; i++) {
    const id = `${prefix}${String(i).padStart(2, "0")}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now()}`;
}

function bfsPath(edges: Edge<LinkStatus>[], from: string, to: string) {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    const a = adj.get(e.source) ?? [];
    const b = adj.get(e.target) ?? [];
    a.push(e.target);
    b.push(e.source);
    adj.set(e.source, a);
    adj.set(e.target, b);
  }
  const q: string[] = [from];
  const prev = new Map<string, string | null>();
  prev.set(from, null);
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const nb of adj.get(cur) ?? []) {
      if (prev.has(nb)) continue;
      prev.set(nb, cur);
      q.push(nb);
    }
  }
  if (!prev.has(to)) return null;
  const nodes: string[] = [];
  let cur: string | null = to;
  while (cur) {
    nodes.push(cur);
    cur = prev.get(cur) ?? null;
  }
  nodes.reverse();
  const edgePairs: Array<[string, string]> = [];
  for (let i = 0; i < nodes.length - 1; i++) edgePairs.push([nodes[i], nodes[i + 1]]);
  return { nodes, edgePairs };
}

function EditorInner() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes] = useState<Node<TopologyNodeData>[]>([]);
  const [edgesPhysical, setEdgesPhysical] = useState<Edge<LinkStatus>[]>([]);
  const [edgesLogical, setEdgesLogical] = useState<Edge<LinkStatus>[]>([]);
  const [mode, setMode] = useState<MapMode>("physical");
  const [topoLoading, setTopoLoading] = useState(true);
  const [topoName, setTopoName] = useState<string | null>(null);

  // ── Backend sync ────────────────────────────────────────────────────────
  const [backendTopoId, setBackendTopoId] = useState<string | null>(null);
  const [backendSyncStatus, setBackendSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const { createTopology, updateTopology } = useTopologyMutations();

  // ── Selection state (must be declared before the useEffect that depends on it) ────
  const [selected, setSelected] = useState<SelectedElement>(null);

  // ── Per-node metrics when Deep-Dive is open ──────────────────────────────
  // Map: node id → Map<metric, value>
  const [nodeMetrics, setNodeMetrics] = useState<Map<string, Map<string, number>>>(new Map());
  const nodeMetricsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When selected element changes, start polling its metrics
  useEffect(() => {
    if (nodeMetricsTimerRef.current) clearInterval(nodeMetricsTimerRef.current);
    if (!selected) return;

    let nodeId: string;
    if (selected.kind === "node") {
      nodeId = selected.nodeId;
    } else {
      // For edges, find the edge and fetch link metrics using "source->target" key
      const edge = edgesPhysical.find((e) => e.id === selected.edgeId) ?? edgesLogical.find((e) => e.id === selected.edgeId);
      if (!edge) return;
      nodeId = `${edge.source}->${edge.target}`;
    }

    const fetchNodeMetrics = () => {
      metricsApi.latest({ node: nodeId }).then((samples) => {
        const m = new Map<string, number>();
        for (const s of samples) m.set(s.metric, s.value);
        setNodeMetrics((prev) => new Map(prev).set(nodeId, m));
      }).catch(() => {});
    };
    fetchNodeMetrics();
    nodeMetricsTimerRef.current = setInterval(fetchNodeMetrics, 5000);
    return () => {
      if (nodeMetricsTimerRef.current) clearInterval(nodeMetricsTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ── Load topology from backend on mount ─────────────────────────────────
  useEffect(() => {
    topologyApi.list().then((topos) => {
      if (!topos.length) {
        // No topologies — fall back to static demo nodes
        setNodes(initialNodes);
        setEdgesPhysical(initialEdgesPhysical);
        setEdgesLogical(initialEdgesLogical);
        setTopoLoading(false);
        return;
      }
      const topo = topos[0];
      setBackendTopoId(topo.id);
      setTopoName(topo.name ?? topo.id);
      if (topo.nodes?.length) {
        // Auto-layout: controller top-center, switches middle, hosts bottom
        const controllers = topo.nodes.filter((n) => n.type === "controller");
        const switches = topo.nodes.filter((n) => n.type === "switch");
        const hosts = topo.nodes.filter((n) => n.type === "host");

        const cx = 500;
        const layoutPos = (arr: typeof topo.nodes, y: number) =>
          arr.reduce<Record<string, { x: number; y: number }>>((acc, n, i) => {
            acc[n.id] = { x: cx - ((arr.length - 1) * 200) / 2 + i * 200, y };
            return acc;
          }, {});

        const positions = {
          ...layoutPos(controllers, 60),
          ...layoutPos(switches, 240),
          ...layoutPos(hosts, 420),
        };

        const rfNodes: Node<TopologyNodeData>[] = topo.nodes.map((n) => ({
          id: n.id,
          type: (n.type as NodeKind) || "host",
          position: positions[n.id] ?? { x: 200, y: 200 },
          data: {
            id: n.id,
            mgmtIp: n.mgmt_ip ?? undefined,
          } as TopologyNodeData,
        }));
        setNodes(rfNodes);
      }
      if (topo.links?.length) {
        const rfEdgesPhys: Edge<LinkStatus>[] = topo.links.map((l, i) => ({
          id: `p-${l.source}-${l.target}-${i}`,
          source: l.source,
          target: l.target,
          type: "util",
          animated: false,
          data: {
            mode: "physical",
            utilPct: 0,
            capacityMbps: l.bandwidth_mbps ?? 1000,
            lossPct: l.loss_pct ?? 0,
            up: true,
          } satisfies LinkStatus,
        }));
        const rfEdgesLog: Edge<LinkStatus>[] = topo.links.map((l, i) => ({
          id: `l-${l.source}-${l.target}-${i}`,
          source: l.source,
          target: l.target,
          type: "util",
          animated: false,
          data: { mode: "logical", up: true, lossPct: 0 } satisfies LinkStatus,
        }));
        setEdgesPhysical(rfEdgesPhys);
        setEdgesLogical(rfEdgesLog);
      }
      setTopoLoading(false);
    }).catch(() => {
      // Backend offline — use static demo
      setNodes(initialNodes);
      setEdgesPhysical(initialEdgesPhysical);
      setEdgesLogical(initialEdgesLogical);
      setTopoLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Poll real metrics and update nodes/edges ──────────────────────────
  useEffect(() => {
    const applyMetrics = (samples: MetricSample[]) => {
      // Build lookup: node -> metric -> value
      const byNode = new Map<string, Map<string, number>>();
      for (const s of samples) {
        if (!byNode.has(s.node)) byNode.set(s.node, new Map());
        byNode.get(s.node)!.set(s.metric, s.value);
      }

      setNodes((prev) =>
        prev.map((n) => {
          const m = byNode.get(n.id);
          if (!m) return n;
          const patch: Partial<TopologyNodeData> = {};
          if (n.type === "controller") {
            const cpu = m.get("docker_cpu_util_pct") ?? m.get("cpu_util_pct");
            const mem = m.get("docker_mem_util_pct") ?? m.get("mem_util_pct");
            const lat = m.get("controller_latency_ms");
            if (cpu !== undefined) patch.cpuPct = cpu;
            if (mem !== undefined) patch.memPct = mem;
            if (lat !== undefined) patch.responseLatencyMs = lat;
            patch.status = (m.get("controller_conn_ok") ?? 1) > 0.5 ? "online" : "offline";
          } else if (n.type === "host") {
            const cpu = m.get("cpu_util_pct");
            const mem = m.get("mem_util_pct");
            const loss = m.get("packet_loss_pct");
            if (cpu !== undefined) patch.cpuPct = cpu;
            if (mem !== undefined) patch.memPct = mem;
            if (loss !== undefined && n.data.ifaceStats) {
              patch.ifaceStats = { ...n.data.ifaceStats };
            }
          } else if (n.type === "switch") {
            const qOcc = m.get("queue_occupancy_pct");
            const loss = m.get("packet_loss_pct");
            if (qOcc !== undefined || loss !== undefined) {
              const prev_pkt = n.data.pktStats ?? { rxPps: 0, txPps: 0, dropPps: 0 };
              patch.pktStats = {
                rxPps: prev_pkt.rxPps,
                txPps: prev_pkt.txPps,
                dropPps: loss !== undefined ? Math.round(loss * 10) : prev_pkt.dropPps,
              };
            }
          }
          if (Object.keys(patch).length === 0) return n;
          return { ...n, data: { ...n.data, ...patch } };
        }),
      );

      // Update physical edge metrics: links stored as "s1->h1" in backend
      setEdgesPhysical((prev) =>
        prev.map((e) => {
          const linkKey = `${e.source}->${e.target}`;
          const revKey = `${e.target}->${e.source}`;
          const lm = byNode.get(linkKey) ?? byNode.get(revKey);
          if (!lm) return e;
          const util = lm.get("link_util_pct") ?? lm.get("if_in_util_pct") ?? lm.get("if_out_util_pct");
          const loss = lm.get("link_loss_pct");
          const up = lm.get("if_link_up");
          const d = e.data ?? ({ mode: "physical" } as LinkStatus);
          return {
            ...e,
            animated: ((loss ?? d.lossPct ?? 0) >= 2.5) || (up !== undefined ? up < 0.5 : !(d.up ?? true)),
            data: {
              ...d,
              utilPct: util ?? d.utilPct ?? 0,
              lossPct: loss ?? d.lossPct ?? 0,
              up: up !== undefined ? up >= 0.5 : (d.up ?? true),
            },
          };
        }),
      );
    };

    // Fetch immediately then every 5 s
    metricsApi.latest().then(applyMetrics).catch(() => {});
    const metricsTimer = setInterval(() => {
      metricsApi.latest().then(applyMetrics).catch(() => {});
    }, 5000);
    return () => clearInterval(metricsTimer);
  }, []);

  const publishToBackend = useCallback(async () => {
    setBackendSyncStatus("saving");
    const backendNodes = nodes.map((n) => ({
      id: n.id,
      type: (n.type ?? "host") as ApiTopology["nodes"][number]["type"],
      mgmt_ip: n.data.mgmtIp ?? n.data.ip ?? null,
      meta: {
        ip: n.data.ip,
        mac: n.data.mac,
        dpid: n.data.dpid,
        position: n.position,
      },
    }));
    const backendLinks = edgesPhysical.map((e) => ({
      source: e.source,
      target: e.target,
      bandwidth_mbps: e.data?.capacityMbps ?? null,
      delay_ms: null,
      loss_pct: e.data?.lossPct ?? null,
    }));
    try {
      if (backendTopoId) {
        await updateTopology(backendTopoId, { nodes: backendNodes, links: backendLinks });
      } else {
        const created = await createTopology({ name: "Topologia Frontend", nodes: backendNodes, links: backendLinks });
        if (created) setBackendTopoId(created.id);
      }
      setBackendSyncStatus("saved");
      setTimeout(() => setBackendSyncStatus("idle"), 2500);
    } catch {
      setBackendSyncStatus("error");
      setTimeout(() => setBackendSyncStatus("idle"), 3000);
    }
  }, [backendTopoId, createTopology, edgesPhysical, nodes, updateTopology]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [hostDraft, setHostDraft] = useState<HostDraft>({
    name: "Host-A",
    ip: "10.0.0.101",
    mac: "aa:bb:cc:dd:ee:ff",
    iface: "eth0",
    gateway: "10.0.0.1",
  });

  const [traceFrom, setTraceFrom] = useState<string>("Host-A");
  const [traceTo, setTraceTo] = useState<string>("Host-D");

  const [panelOpen, setPanelOpen] = useState<null | "snapshots" | "scenarios">(null);

  const [snapshots, setSnapshots] = useState<TopologySnapshot[]>([]);
  const [compareA, setCompareA] = useState<string | null>(null);
  const [compareB, setCompareB] = useState<string | null>(null);

  const edges = mode === "physical" ? edgesPhysical : edgesLogical;
  const setEdges = mode === "physical" ? setEdgesPhysical : setEdgesLogical;

  const selectedNode = useMemo(() => {
    if (!selected || selected.kind !== "node") return null;
    return nodes.find((n) => n.id === selected.nodeId) ?? null;
  }, [nodes, selected]);

  const selectedEdge = useMemo(() => {
    if (!selected || selected.kind !== "edge") return null;
    return (
      edgesPhysical.find((e) => e.id === selected.edgeId) ??
      edgesLogical.find((e) => e.id === selected.edgeId) ??
      null
    );
  }, [edgesLogical, edgesPhysical, selected]);

  const countByType = useMemo(() => {
    const res: Record<NodeKind, number> = { host: 0, switch: 0, controller: 0 };
    for (const n of nodes) {
      if (n.type === "host") res.host++;
      else if (n.type === "switch") res.switch++;
      else if (n.type === "controller") res.controller++;
    }
    return res;
  }, [nodes]);

  const placeNewNode = useCallback(
    (kind: NodeKind) => {
      const bounds = wrapperRef.current?.getBoundingClientRect();
      const w = bounds?.width ?? 1100;

      const padX = 80;
      const padY = 90;

      if (kind === "controller") {
        const i = countByType.controller;
        return { x: padX + i * 260, y: 40 };
      }
      if (kind === "switch") {
        const i = countByType.switch;
        return { x: padX + (i % 3) * 300, y: 200 + Math.floor(i / 3) * 180 };
      }

      const i = countByType.host;
      const cols = Math.max(2, Math.floor((w - padX * 2) / 220));
      return {
        x: padX + (i % cols) * 220,
        y: 380 + Math.floor(i / cols) * 160 + padY,
      };
    },
    [countByType.controller, countByType.host, countByType.switch],
  );

  const reloadSnapshots = useCallback(() => {
    setSnapshots(readSnapshotsFromStorage());
  }, []);

  useEffect(() => {
    reloadSnapshots();
  }, [reloadSnapshots]);





  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: "util",
            animated: false,
            data:
              mode === "physical"
                ? ({ mode: "physical", utilPct: 10, capacityMbps: 1000, lossPct: 0.0, up: true } satisfies LinkStatus)
                : ({ mode: "logical", up: true, lossPct: 0 } satisfies LinkStatus),
          },
          eds,
        ),
      );
      setMenuOpen(false);
    },
    [mode, setEdges],
  );

  const onNodeClick = useCallback((_: any, node: Node<TopologyNodeData>) => {
    setSelected({ kind: "node", nodeId: node.id });
    setMenuOpen(false);
  }, []);

  const onEdgeClick = useCallback((_: any, edge: Edge<LinkStatus>) => {
    setSelected({ kind: "edge", edgeId: edge.id });
    setMenuOpen(false);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelected(null);
    setMenuOpen(false);
  }, []);

  const clearTrace = useCallback(() => {
    setEdgesPhysical((prev) => prev.map((e) => ({ ...e, data: { ...(e.data ?? { mode: "physical" }), trace: false } })));
    setEdgesLogical((prev) => prev.map((e) => ({ ...e, data: { ...(e.data ?? { mode: "logical" }), trace: false } })));
  }, []);

  const runTrace = useCallback(() => {
    clearTrace();
    const p = bfsPath(edges, traceFrom, traceTo);
    if (!p) return;
    setEdges((prev) =>
      prev.map((e) => {
        const hit = p.edgePairs.some(([a, b]) => (e.source === a && e.target === b) || (e.source === b && e.target === a));
        if (!hit) return e;
        return {
          ...e,
          animated: true,
          data: { ...(e.data ?? ({ mode: mode === "physical" ? "physical" : "logical" } as LinkStatus)), trace: true },
        };
      }),
    );
  }, [clearTrace, edges, mode, setEdges, traceFrom, traceTo]);

  const captureSnapshot = useCallback(() => {
    const key = "netops.topology.snapshots";
    const prev = readSnapshotsFromStorage();
    const payload = {
      capturedAt: new Date().toISOString(),
      mode,
      nodes,
      edgesPhysical,
      edgesLogical,
    };
    const next = [payload, ...prev].slice(0, 50);
    localStorage.setItem(key, JSON.stringify(next));
    reloadSnapshots();
  }, [edgesLogical, edgesPhysical, mode, nodes, reloadSnapshots]);

  const applySnapshot = useCallback((snap: TopologySnapshot) => {
    setMode(snap.mode);
    setNodes(snap.nodes);
    setEdgesPhysical(snap.edgesPhysical);
    setEdgesLogical(snap.edgesLogical);
    setPanelOpen(null);
  }, []);

  const usedIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const addSwitch = useCallback(() => {
    const id = nextId("Switch-", usedIds);
    const pos = placeNewNode("switch");
    setNodes((prev) =>
      prev.concat({
        id,
        type: "switch",
        position: pos,
        data: {
          id,
          dpid: "0000000000000000",
          mgmtIp: "10.0.0.1",
          pktStats: { rxPps: 200, txPps: 180, dropPps: 0 },
          ports: [
            { portNo: 1, name: `${id}-eth1`, rxPkts: 0, txPkts: 0, errors: 0 },
            { portNo: 2, name: `${id}-eth2`, rxPkts: 0, txPkts: 0, errors: 0 },
          ],
          flowTables: [
            { table: 0, priority: 100, match: "ip", actions: "output:1", packets: 0, bytes: 0 },
            { table: 0, priority: 10, match: "arp", actions: "flood", packets: 0, bytes: 0 },
          ],
        },
      }),
    );
  }, [placeNewNode, usedIds]);

  const addController = useCallback(() => {
    const id = nextId("Controller-", usedIds);
    const pos = placeNewNode("controller");
    setNodes((prev) =>
      prev.concat({
        id,
        type: "controller",
        position: pos,
        data: { id, mgmtIp: "10.0.0.10", status: "online", responseLatencyMs: 8 },
      }),
    );
  }, [placeNewNode, usedIds]);

  const addHost = useCallback(() => {
    setHostDraft((d) => ({
      ...d,
      name: nextId("Host-", usedIds).replace("Host-", "Host-"),
      ip: `10.0.0.${100 + Math.floor(Math.random() * 120)}`,
      mac: `aa:bb:cc:dd:ee:${Math.floor(Math.random() * 255).toString(16).padStart(2, "0")}`,
      iface: "eth0",
      gateway: "10.0.0.1",
    }));
    setMenuOpen(false);
    setHostModalOpen(true);
  }, [usedIds]);

  useEffect(() => {
    // Avoid stale selection when changing map mode.
    if (selected && selected.kind === "edge") setSelected(null);
    setMenuOpen(false);
  }, [mode, selected]);

  const submitHost = useCallback(() => {
    const id = hostDraft.name.trim() || nextId("Host-", usedIds);
    const pos = placeNewNode("host");

    setNodes((prev) =>
      prev.concat({
        id,
        type: "host",
        position: pos,
        data: {
          id,
          ip: hostDraft.ip,
          mac: hostDraft.mac,
          iface: hostDraft.iface,
          gateway: hostDraft.gateway,
          arpTable: synthArpTable(id),
          sockets: synthSockets(),
          ifaceStats: synthIfaceStats(id),
          cpuPct: 18,
          memPct: 42,
        },
      }),
    );

    setHostModalOpen(false);
    setMenuOpen(false);
  }, [hostDraft, placeNewNode, usedIds]);

  const scenarios = useMemo<ScenarioSpec[]>(() => {
    const baseNodes = () => clone(initialNodes);
    const basePhys = () => clone(initialEdgesPhysical);
    const baseLog = () => clone(initialEdgesLogical);

    return [
      {
        id: "base",
        title: "Base (demo)",
        subtitle: "Topologia completa com perda alta e 1 link DOWN",
        apply: () => ({ mode: "physical", nodes: baseNodes(), edgesPhysical: basePhys(), edgesLogical: baseLog(), traceFrom: "Host-A", traceTo: "Host-D" }),
      },
      {
        id: "all-ok",
        title: "Tudo OK (visual)",
        subtitle: "Links UP, perda baixa, sem pulse/dotted",
        apply: () => {
          const phys = basePhys().map((e) => ({
            ...e,
            animated: false,
            data: { ...(e.data ?? { mode: "physical" }), up: true, lossPct: 0.1, utilPct: e.data?.utilPct ?? 15, trace: false },
          }));
          return { mode: "physical", nodes: baseNodes(), edgesPhysical: phys, edgesLogical: baseLog(), traceFrom: "Host-A", traceTo: "Host-D" };
        },
      },
      {
        id: "degraded",
        title: "Degradação (perda alta)",
        subtitle: "Força pulse + dotted no backbone",
        apply: () => {
          const phys = basePhys().map((e) => {
            if (e.id !== "p-s1-s2") return { ...e, data: { ...(e.data ?? { mode: "physical" }), trace: false } };
            return { ...e, animated: true, data: { ...(e.data ?? { mode: "physical" }), up: true, lossPct: 5.6, utilPct: 79 } };
          });
          return { mode: "physical", nodes: baseNodes(), edgesPhysical: phys, edgesLogical: baseLog(), traceFrom: "Host-A", traceTo: "Host-D" };
        },
      },
      {
        id: "down",
        title: "Falha (DOWN)",
        subtitle: "Força link de acesso DOWN (dashed + pulse)",
        apply: () => {
          const phys = basePhys().map((e) => {
            if (e.id !== "p-s1-hb") return { ...e, data: { ...(e.data ?? { mode: "physical" }), trace: false } };
            return { ...e, animated: true, data: { ...(e.data ?? { mode: "physical" }), up: false, lossPct: 0, utilPct: 0 } };
          });
          return { mode: "physical", nodes: baseNodes(), edgesPhysical: phys, edgesLogical: baseLog(), traceFrom: "Host-B", traceTo: "Switch-01" };
        },
      },
      {
        id: "trace",
        title: "TracePath (visual)",
        subtitle: "Marca caminho Host-A → Host-D",
        apply: () => {
          const phys = markTraceEdges(basePhys(), [
            ["Host-A", "Switch-01"],
            ["Switch-01", "Switch-02"],
            ["Switch-02", "Host-D"],
          ]);
          return { mode: "physical", nodes: baseNodes(), edgesPhysical: phys, edgesLogical: baseLog(), traceFrom: "Host-A", traceTo: "Host-D" };
        },
      },
    ];
  }, []);

  const applyScenario = useCallback((id: ScenarioId) => {
    const spec = scenarios.find((s) => s.id === id);
    if (!spec) return;
    const next = spec.apply();
    setMode(next.mode);
    setNodes(next.nodes);
    setEdgesPhysical(next.edgesPhysical);
    setEdgesLogical(next.edgesLogical);
    if (next.traceFrom) setTraceFrom(next.traceFrom);
    if (next.traceTo) setTraceTo(next.traceTo);
    setPanelOpen(null);
  }, [scenarios]);

  const drawerOpen = selectedNode !== null || selectedEdge !== null;

  if (topoLoading) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-border-0/60 bg-bg-1/40">
        <div className="flex flex-col items-center gap-3 text-fg-1">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg-1/30 border-t-accent-ok" />
          <div className="text-sm">Carregando topologia do backend…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold tracking-tight">Topologia Interativa</div>
            {topoName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-ok/10 px-2 py-0.5 text-[11px] font-medium text-accent-ok">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-ok" />
                {topoName}
              </span>
            )}
          </div>
          <div className="text-[11px] text-fg-1">Editor completo (React Flow) · gestão de infraestrutura</div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant={mode === "logical" ? "primary" : "ghost"}
              className="h-8"
              onClick={() => {
                setMode("logical");
                setSelected(null);
                setMenuOpen(false);
              }}
            >
              Mapa Lógico
            </Button>
            <Button
              variant={mode === "physical" ? "primary" : "ghost"}
              className="h-8"
              onClick={() => {
                setMode("physical");
                setSelected(null);
                setMenuOpen(false);
              }}
            >
              Mapa Físico
            </Button>
          </div>

          <Button
            variant={panelOpen === "snapshots" ? "primary" : "ghost"}
            className="h-8"
            onClick={() => setPanelOpen((p) => (p === "snapshots" ? null : "snapshots"))}
          >
            Snapshots
          </Button>
          <Button
            variant={panelOpen === "scenarios" ? "primary" : "ghost"}
            className="h-8"
            onClick={() => setPanelOpen((p) => (p === "scenarios" ? null : "scenarios"))}
          >
            Cenários
          </Button>

          <div className="flex items-center gap-2 rounded-lg border border-border-0/60 bg-bg-1/40 px-2 py-1">
            <div className="text-[10px] font-medium text-fg-1">TracePath</div>
            <select
              className="h-7 rounded-md border border-border-0/60 bg-bg-2/40 px-2 text-[11px] text-fg-0 focus-visible:outline-none"
              value={traceFrom}
              onChange={(e) => setTraceFrom(e.target.value)}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.id}</option>
              ))}
            </select>
            <select
              className="h-7 rounded-md border border-border-0/60 bg-bg-2/40 px-2 text-[11px] text-fg-0 focus-visible:outline-none"
              value={traceTo}
              onChange={(e) => setTraceTo(e.target.value)}
            >
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.id}</option>
              ))}
            </select>
            <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={runTrace}>Executar</Button>
            <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={clearTrace}>Limpar</Button>
          </div>

          <Button variant="ghost" className="h-8" onClick={captureSnapshot}>Capturar Snapshot</Button>

          <Button
            variant="primary"
            className="h-8"
            onClick={publishToBackend}
            disabled={backendSyncStatus === "saving"}
          >
            {backendSyncStatus === "saving"
              ? "Salvando…"
              : backendSyncStatus === "saved"
                ? "✓ Salvo"
                : backendSyncStatus === "error"
                  ? "Erro!"
                  : "Publicar no Back-end"}
          </Button>
          {backendTopoId && (
            <span className="text-[10px] text-fg-1 font-mono">{backendTopoId}</span>
          )}
        </div>
      </div>

      {panelOpen ? (
        <div className="rounded-xl border border-border-0/60 bg-bg-0/60 p-2 backdrop-blur">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-medium text-fg-1">
              {panelOpen === "snapshots" ? "Snapshots" : "Cenários de teste"}
            </div>
            <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setPanelOpen(null)}>
              Fechar
            </Button>
          </div>

          <div className="max-h-[240px] overflow-auto pr-1">
            {panelOpen === "scenarios" ? (
              <div className="grid grid-cols-1 gap-2">
                {scenarios.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => applyScenario(s.id)}
                    className={cn(
                      "rounded-xl border border-border-0/60 bg-bg-1/40 p-2 text-left",
                      "hover:bg-bg-2/30",
                    )}
                  >
                    <div className="text-[12px] font-semibold text-fg-0">{s.title}</div>
                    <div className="mt-0.5 text-[11px] text-fg-1">{s.subtitle}</div>
                  </button>
                ))}
              </div>
            ) : snapshots.length === 0 ? (
              <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2 text-[11px] text-fg-1">
                Nenhum snapshot ainda. Use “Capturar Snapshot”.
              </div>
            ) : (
              <div className="space-y-2">
                {snapshots.map((s) => (
                  <div key={s.capturedAt} className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-[11px] text-fg-0">{new Date(s.capturedAt).toLocaleString()}</div>
                        <div className="mt-0.5 text-[10px] text-fg-1">
                          modo=<span className="font-mono text-fg-0">{s.mode}</span> · nós=<span className="font-mono text-fg-0">{s.nodes.length}</span> · phys=<span className="font-mono text-fg-0">{s.edgesPhysical.length}</span> · log=<span className="font-mono text-fg-0">{s.edgesLogical.length}</span>
                        </div>
                      </div>
                      <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => applySnapshot(s)}>
                        Aplicar
                      </Button>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant={compareA === s.capturedAt ? "primary" : "ghost"}
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setCompareA((p) => (p === s.capturedAt ? null : s.capturedAt))}
                      >
                        Marcar A
                      </Button>
                      <Button
                        variant={compareB === s.capturedAt ? "primary" : "ghost"}
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setCompareB((p) => (p === s.capturedAt ? null : s.capturedAt))}
                      >
                        Marcar B
                      </Button>
                    </div>
                  </div>
                ))}

                {compareA && compareB ? (
                  (() => {
                    const a = snapshots.find((s) => s.capturedAt === compareA);
                    const b = snapshots.find((s) => s.capturedAt === compareB);
                    if (!a || !b) return null;
                    const diff = summarizeSnapshotDiff(a, b);
                    return (
                      <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                        <div className="mb-2 text-[11px] font-medium text-fg-1">Comparação (A → B)</div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-md border border-border-0/60 bg-bg-2/20 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">nós</div>
                            <div className="mt-0.5 font-mono text-[12px] text-fg-0">+{diff.nodesAdded} / -{diff.nodesRemoved}</div>
                          </div>
                          <div className="rounded-md border border-border-0/60 bg-bg-2/20 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">movidos</div>
                            <div className="mt-0.5 font-mono text-[12px] text-fg-0">{diff.nodesMoved}</div>
                          </div>
                          <div className="rounded-md border border-border-0/60 bg-bg-2/20 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">down (phys)</div>
                            <div className={cn("mt-0.5 font-mono text-[12px]", diff.physDownDelta > 0 ? "text-accent-danger" : "text-fg-0")}>
                              {diff.physDownDelta >= 0 ? "+" : ""}
                              {diff.physDownDelta}
                            </div>
                          </div>
                          <div className="rounded-md border border-border-0/60 bg-bg-2/20 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">perda alta (phys)</div>
                            <div className={cn("mt-0.5 font-mono text-[12px]", diff.physDangerDelta > 0 ? "text-accent-danger" : "text-fg-0")}>
                              {diff.physDangerDelta >= 0 ? "+" : ""}
                              {diff.physDangerDelta}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      <div className={cn("grid gap-3", drawerOpen ? "grid-cols-[1fr_360px]" : "grid-cols-1")}>
        <div className="min-w-0">
          <div ref={wrapperRef} className="relative h-[74vh] w-full overflow-hidden rounded-xl border border-border-0/60">
            <ReactFlow
              key={topoName ?? "topo"}
              nodes={nodes}
              edges={edges}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              fitView
              fitViewOptions={{ padding: 0.3 }}
            >
              <Background gap={18} size={1} color="rgba(40,49,73,0.9)" />
              <Controls />
            </ReactFlow>

            {/* Floating + button (inside canvas, so it never covers the drawer) */}
            <div
              className="absolute bottom-3 right-3 z-10"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {menuOpen ? (
                <div className="mb-2 w-[220px] rounded-xl border border-border-0/60 bg-bg-0/90 p-2 text-[11px] text-fg-1 backdrop-blur">
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-fg-1">Adicionar</div>
                  <div className="space-y-1">
                    <Button className="w-full justify-start" variant="ghost" onClick={addHost}>Adicionar Host</Button>
                    <Button className="w-full justify-start" variant="ghost" onClick={() => { addSwitch(); setMenuOpen(false); }}>Adicionar Switch</Button>
                    <Button className="w-full justify-start" variant="ghost" onClick={() => { addController(); setMenuOpen(false); }}>Adicionar Controlador</Button>
                  </div>
                </div>
              ) : null}

              <Button
                variant="primary"
                className="h-10 w-10 justify-center rounded-full px-0 text-[16px]"
                onClick={() => setMenuOpen((p) => !p)}
                aria-label="Adicionar"
                title="Adicionar"
              >
                +
              </Button>
            </div>
          </div>
        </div>

        {drawerOpen ? (
          <aside className="min-w-0">
            <div className="sticky top-12 h-[74vh] overflow-hidden rounded-xl border border-border-0/60 bg-bg-0/70 backdrop-blur">
              <div className="flex items-center justify-between border-b border-border-0/60 px-3 py-2">
                <div className="text-[12px] font-semibold text-fg-0">Deep-Dive</div>
                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setSelected(null)}>Fechar</Button>
              </div>

              <div className="h-[calc(74vh-41px)] overflow-auto px-3 py-2">
                {selectedEdge ? (
                  (() => {
                    // Find real link metrics from backend (node key is "source->target")
                    const lkA = `${selectedEdge.source}->${selectedEdge.target}`;
                    const lkB = `${selectedEdge.target}->${selectedEdge.source}`;
                    const lm = nodeMetrics.get(lkA) ?? nodeMetrics.get(lkB);
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[11px] font-semibold text-fg-0">Link</div>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", (selectedEdge.data?.up ?? true) ? "bg-accent-ok/10 text-accent-ok" : "bg-accent-danger/10 text-accent-danger")}>
                            {(selectedEdge.data?.up ?? true) ? "UP" : "DOWN"}
                          </span>
                        </div>
                        <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                          <div className="font-mono text-[12px] text-fg-0">{selectedEdge.source} ↔ {selectedEdge.target}</div>
                          <div className="mt-0.5 text-[10px] text-fg-1">Capacidade: {selectedEdge.data?.capacityMbps ? `${selectedEdge.data.capacityMbps >= 1000 ? `${(selectedEdge.data.capacityMbps/1000).toFixed(0)} Gbps` : `${selectedEdge.data.capacityMbps} Mbps`}` : "—"}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">Utilização</div>
                            <div className="mt-0.5 font-mono text-[13px] text-fg-0">{(lm?.get("link_util_pct") ?? selectedEdge.data?.utilPct ?? 0).toFixed(1)}%</div>
                          </div>
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">Perda pkts</div>
                            <div className={cn("mt-0.5 font-mono text-[13px]", (lm?.get("link_loss_pct") ?? selectedEdge.data?.lossPct ?? 0) >= 2.5 ? "text-accent-danger" : "text-fg-0")}>
                              {(lm?.get("link_loss_pct") ?? selectedEdge.data?.lossPct ?? 0).toFixed(2)}%
                            </div>
                          </div>
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">RX pkts</div>
                            <div className="mt-0.5 font-mono text-[13px] text-fg-0">{lm?.get("port_rx_pkts") !== undefined ? lm.get("port_rx_pkts")!.toLocaleString() : "—"}</div>
                          </div>
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">TX pkts</div>
                            <div className="mt-0.5 font-mono text-[13px] text-fg-0">{lm?.get("port_tx_pkts") !== undefined ? lm.get("port_tx_pkts")!.toLocaleString() : "—"}</div>
                          </div>
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">Jitter</div>
                            <div className="mt-0.5 font-mono text-[13px] text-fg-0">{lm?.get("link_jitter_ms") !== undefined ? `${lm.get("link_jitter_ms")!.toFixed(2)} ms` : "—"}</div>
                          </div>
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">Erros</div>
                            <div className="mt-0.5 font-mono text-[13px] text-fg-0">{lm?.get("if_errors") !== undefined ? lm.get("if_errors")!.toFixed(0) : "—"}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })()
                ) : selectedNode ? (
                  (() => {
                    const nm = nodeMetrics.get(selectedNode.id) ?? new Map<string, number>();
                    const fmt = (v: number | undefined, decimals = 1, suffix = "") =>
                      v !== undefined ? `${v.toFixed(decimals)}${suffix}` : "—";
                    const fmtInt = (v: number | undefined, suffix = "") =>
                      v !== undefined ? `${v.toLocaleString()}${suffix}` : "—";

                    return (
                      <div className="space-y-3">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-mono text-[14px] font-bold text-fg-0">{selectedNode.id}</div>
                            <div className="text-[10px] uppercase tracking-wide text-fg-1">{selectedNode.type}</div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {selectedNode.type === "controller" && (
                              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", selectedNode.data.status !== "offline" ? "bg-accent-ok/10 text-accent-ok" : "bg-accent-danger/10 text-accent-danger")}>
                                {selectedNode.data.status !== "offline" ? "ONLINE" : "OFFLINE"}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Identity */}
                        <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-1">Identidade</div>
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                            <div><span className="text-fg-1">Mgmt IP</span><div className="font-mono text-fg-0">{selectedNode.data.mgmtIp ?? "—"}</div></div>
                            <div><span className="text-fg-1">Tipo</span><div className="font-mono text-fg-0">{selectedNode.type}</div></div>
                            {selectedNode.type === "switch" && (
                              <div className="col-span-2"><span className="text-fg-1">DPID</span><div className="font-mono text-fg-0">{selectedNode.data.dpid ?? "—"}</div></div>
                            )}
                            {selectedNode.type === "controller" && (
                              <div><span className="text-fg-1">Latência OF</span><div className="font-mono text-fg-0">{fmt(nm.get("controller_latency_ms") ?? selectedNode.data.responseLatencyMs, 1, " ms")}</div></div>
                            )}
                          </div>
                        </div>

                        {/* Resources */}
                        {(nm.get("docker_cpu_util_pct") !== undefined || nm.get("cpu_util_pct") !== undefined || nm.get("docker_mem_util_pct") !== undefined) && (
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-1">Recursos (Docker)</div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <div className="flex justify-between text-[10px]"><span className="text-fg-1">CPU</span><span className="font-mono text-fg-0">{fmt(nm.get("docker_cpu_util_pct") ?? nm.get("cpu_util_pct"), 1, "%")}</span></div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border-0/40"><div className="h-full rounded-full bg-accent-ok" style={{ width: `${Math.min(100, nm.get("docker_cpu_util_pct") ?? nm.get("cpu_util_pct") ?? 0)}%` }} /></div>
                              </div>
                              <div>
                                <div className="flex justify-between text-[10px]"><span className="text-fg-1">MEM</span><span className="font-mono text-fg-0">{fmt(nm.get("docker_mem_util_pct") ?? nm.get("mem_util_pct"), 1, "%")}</span></div>
                                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border-0/40"><div className="h-full rounded-full bg-accent-ok" style={{ width: `${Math.min(100, nm.get("docker_mem_util_pct") ?? nm.get("mem_util_pct") ?? 0)}%` }} /></div>
                              </div>
                              {nm.get("docker_net_rx_bytes") !== undefined && (
                                <div><span className="text-[10px] text-fg-1">Net RX</span><div className="font-mono text-[11px] text-fg-0">{fmtInt(nm.get("docker_net_rx_bytes"), " B")}</div></div>
                              )}
                              {nm.get("docker_net_tx_bytes") !== undefined && (
                                <div><span className="text-[10px] text-fg-1">Net TX</span><div className="font-mono text-[11px] text-fg-0">{fmtInt(nm.get("docker_net_tx_bytes"), " B")}</div></div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Network metrics */}
                        {(nm.get("latency_ms") !== undefined || nm.get("packet_loss_pct") !== undefined || nm.get("jitter_ms") !== undefined) && (
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-1">Rede</div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              {nm.get("latency_ms") !== undefined && <div><span className="text-fg-1">Latência</span><div className="font-mono text-fg-0">{fmt(nm.get("latency_ms"), 2, " ms")}</div></div>}
                              {nm.get("packet_loss_pct") !== undefined && <div><span className="text-fg-1">Perda</span><div className={cn("font-mono", (nm.get("packet_loss_pct") ?? 0) > 1 ? "text-accent-danger" : "text-fg-0")}>{fmt(nm.get("packet_loss_pct"), 2, "%")}</div></div>}
                              {nm.get("jitter_ms") !== undefined && <div><span className="text-fg-1">Jitter</span><div className="font-mono text-fg-0">{fmt(nm.get("jitter_ms"), 2, " ms")}</div></div>}
                              {nm.get("throughput_mbps") !== undefined && <div><span className="text-fg-1">Throughput</span><div className="font-mono text-fg-0">{fmt(nm.get("throughput_mbps"), 1, " Mbps")}</div></div>}
                              {nm.get("routes_count") !== undefined && <div><span className="text-fg-1">Rotas</span><div className="font-mono text-fg-0">{fmtInt(nm.get("routes_count"))}</div></div>}
                              {nm.get("arp_entries") !== undefined && <div><span className="text-fg-1">Entradas ARP</span><div className="font-mono text-fg-0">{fmtInt(nm.get("arp_entries"))}</div></div>}
                            </div>
                          </div>
                        )}

                        {/* Controller-specific */}
                        {selectedNode.type === "controller" && (
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-1">OpenFlow / Controle</div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <div><span className="text-fg-1">Flows instalados</span><div className="font-mono text-fg-0">{fmtInt(nm.get("flows_installed"))}</div></div>
                              <div><span className="text-fg-1">Flows removidos</span><div className="font-mono text-fg-0">{fmtInt(nm.get("flows_removed"))}</div></div>
                              <div><span className="text-fg-1">Reconexões OF</span><div className="font-mono text-fg-0">{fmtInt(nm.get("of_channel_reconnects"))}</div></div>
                              <div><span className="text-fg-1">Conn OK</span><div className={cn("font-mono", (nm.get("controller_conn_ok") ?? 1) > 0.5 ? "text-accent-ok" : "text-accent-danger")}>{nm.get("controller_conn_ok") !== undefined ? ((nm.get("controller_conn_ok")! > 0.5) ? "Sim" : "Não") : "—"}</div></div>
                              <div><span className="text-fg-1">Alertas</span><div className="font-mono text-fg-0">{fmtInt(nm.get("alerts_count"))}</div></div>
                              <div><span className="text-fg-1">Fila</span><div className="font-mono text-fg-0">{fmtInt(nm.get("queue_depth"))}</div></div>
                            </div>
                            <div className="mt-2 text-[10px] text-fg-1">Switches sob gestão</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {nodes.filter((n) => n.type === "switch").map((s) => (
                                <span key={s.id} className="rounded-md border border-border-0/60 bg-bg-2/20 px-2 py-0.5 font-mono text-[10px] text-fg-0">{s.id}</span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Switch-specific */}
                        {selectedNode.type === "switch" && (
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-1">Switch</div>
                            <div className="grid grid-cols-3 gap-2 text-[11px]">
                              <div><span className="text-fg-1">RX pps</span><div className="font-mono text-fg-0">{selectedNode.data.pktStats?.rxPps ?? 0}</div></div>
                              <div><span className="text-fg-1">TX pps</span><div className="font-mono text-fg-0">{selectedNode.data.pktStats?.txPps ?? 0}</div></div>
                              <div><span className="text-fg-1">DROP</span><div className={cn("font-mono", (selectedNode.data.pktStats?.dropPps ?? 0) > 0 ? "text-accent-warn" : "text-fg-0")}>{selectedNode.data.pktStats?.dropPps ?? 0}</div></div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                              {nm.get("queue_occupancy_pct") !== undefined && <div><span className="text-fg-1">Fila</span><div className="font-mono text-fg-0">{fmt(nm.get("queue_occupancy_pct"), 1, "%")}</div></div>}
                              {nm.get("queue_drops") !== undefined && <div><span className="text-fg-1">Queue drops</span><div className="font-mono text-fg-0">{fmtInt(nm.get("queue_drops"))}</div></div>}
                              {nm.get("snmp_tcp_currestab") !== undefined && <div><span className="text-fg-1">TCP Estab</span><div className="font-mono text-fg-0">{fmtInt(nm.get("snmp_tcp_currestab"))}</div></div>}
                              {nm.get("snmp_ip_inreceives") !== undefined && <div><span className="text-fg-1">IP RX</span><div className="font-mono text-fg-0">{fmtInt(nm.get("snmp_ip_inreceives"))}</div></div>}
                            </div>
                          </div>
                        )}

                        {/* Host-specific */}
                        {selectedNode.type === "host" && (
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-1">Host</div>
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              {nm.get("dns_latency_ms") !== undefined && <div><span className="text-fg-1">DNS lat</span><div className="font-mono text-fg-0">{fmt(nm.get("dns_latency_ms"), 1, " ms")}</div></div>}
                              {nm.get("dns_success_pct") !== undefined && <div><span className="text-fg-1">DNS ok</span><div className="font-mono text-fg-0">{fmt(nm.get("dns_success_pct"), 1, "%")}</div></div>}
                              {nm.get("http_latency_ms") !== undefined && <div><span className="text-fg-1">HTTP lat</span><div className="font-mono text-fg-0">{fmt(nm.get("http_latency_ms"), 1, " ms")}</div></div>}
                              {nm.get("http_success_pct") !== undefined && <div><span className="text-fg-1">HTTP ok</span><div className="font-mono text-fg-0">{fmt(nm.get("http_success_pct"), 1, "%")}</div></div>}
                              {nm.get("tcp_rtt_ms") !== undefined && <div><span className="text-fg-1">TCP RTT</span><div className="font-mono text-fg-0">{fmt(nm.get("tcp_rtt_ms"), 2, " ms")}</div></div>}
                              {nm.get("snmp_tcp_currestab") !== undefined && <div><span className="text-fg-1">TCP Estab</span><div className="font-mono text-fg-0">{fmtInt(nm.get("snmp_tcp_currestab"))}</div></div>}
                              {nm.get("ss_tcp_sockets_total") !== undefined && <div><span className="text-fg-1">Sockets TCP</span><div className="font-mono text-fg-0">{fmtInt(nm.get("ss_tcp_sockets_total"))}</div></div>}
                              {nm.get("app_rps") !== undefined && <div><span className="text-fg-1">App RPS</span><div className="font-mono text-fg-0">{fmt(nm.get("app_rps"), 1)}</div></div>}
                            </div>
                          </div>
                        )}

                        {/* Raw metrics table — all available */}
                        {nm.size > 0 && (
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-2">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-fg-1">Todas as métricas ({nm.size})</div>
                            <div className="max-h-[300px] overflow-auto">
                              <table className="w-full border-collapse text-left text-[10px]">
                                <thead className="sticky top-0 bg-bg-1">
                                  <tr className="border-b border-border-0/40 text-fg-1">
                                    <th className="py-1 pr-2 font-medium">Métrica</th>
                                    <th className="py-1 font-medium">Valor</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {Array.from(nm.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => (
                                    <tr key={k} className="border-b border-border-0/20 hover:bg-bg-2/20">
                                      <td className="py-0.5 pr-2 font-mono text-fg-1">{k}</td>
                                      <td className="py-0.5 font-mono text-fg-0">{v.toFixed(3)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {nm.size === 0 && (
                          <div className="rounded-lg border border-border-0/60 bg-bg-1/40 p-3 text-center text-[11px] text-fg-1">
                            <div className="animate-pulse">Carregando métricas de <span className="font-mono text-fg-0">{selectedNode.id}</span>…</div>
                          </div>
                        )}
                      </div>
                    );
                  })()
                ) : null}
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {/* Host modal */}
      {hostModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg-0/70 p-4 backdrop-blur">
          <div className="w-full max-w-[560px] rounded-xl border border-border-0/60 bg-bg-1/80 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <div className="text-[13px] font-semibold text-fg-0">Configurar Host</div>
                <div className="text-[11px] text-fg-1">Nome, IP, MAC, Interface, Gateway</div>
              </div>
              <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setHostModalOpen(false)}>Fechar</Button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-medium text-fg-1">Nome</div>
                <Input value={hostDraft.name} onChange={(e) => setHostDraft((p) => ({ ...p, name: e.target.value }))} placeholder="Host-A" />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-medium text-fg-1">Interface</div>
                <Input value={hostDraft.iface} onChange={(e) => setHostDraft((p) => ({ ...p, iface: e.target.value }))} placeholder="eth0" />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-medium text-fg-1">IP</div>
                <Input value={hostDraft.ip} onChange={(e) => setHostDraft((p) => ({ ...p, ip: e.target.value }))} placeholder="10.0.0.101" />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-medium text-fg-1">Gateway</div>
                <Input value={hostDraft.gateway} onChange={(e) => setHostDraft((p) => ({ ...p, gateway: e.target.value }))} placeholder="10.0.0.1" />
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1 text-[10px] font-medium text-fg-1">MAC</div>
                <Input value={hostDraft.mac} onChange={(e) => setHostDraft((p) => ({ ...p, mac: e.target.value }))} placeholder="aa:bb:cc:dd:ee:ff" />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setHostModalOpen(false)}>Cancelar</Button>
              <Button variant="primary" onClick={submitHost}>Adicionar Host</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function TopologyEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}

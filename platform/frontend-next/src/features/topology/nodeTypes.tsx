"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { cn } from "@/lib/cn";
import { Server, Cpu, Network } from "lucide-react";

function MiniBar({ pct, danger }: { pct: number; danger?: boolean }) {
  return (
    <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-border-0/40">
      <div
        className={cn("h-full rounded-full", danger ? "bg-accent-danger" : "bg-accent-ok")}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-fg-1">{label}</div>
      <div className={cn("font-mono text-[11px]", danger ? "text-accent-danger" : "text-fg-0")}>{value}</div>
    </div>
  );
}

export function ControllerNode(
  props: NodeProps<{
    id: string;
    mgmtIp?: string;
    status?: "online" | "offline";
    responseLatencyMs?: number;
    cpuPct?: number;
    memPct?: number;
  }>,
) {
  const { data } = props;
  const online = data.status !== "offline";
  return (
    <>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-border-0" />
      <div className="min-w-[190px] rounded-xl border border-border-0/60 bg-bg-1/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 flex-shrink-0 text-fg-1" />
          <span className="flex-1 truncate font-mono text-[13px] font-bold text-fg-0">{data.id}</span>
          <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", online ? "bg-accent-ok" : "bg-accent-danger")} />
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-fg-1">{data.mgmtIp ?? "controller"}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <div>
            <Stat label="CPU" value={data.cpuPct !== undefined ? `${data.cpuPct.toFixed(1)}%` : "—"} danger={data.cpuPct !== undefined && data.cpuPct > 80} />
            {data.cpuPct !== undefined && <MiniBar pct={data.cpuPct} danger={data.cpuPct > 80} />}
          </div>
          <div>
            <Stat label="MEM" value={data.memPct !== undefined ? `${data.memPct.toFixed(1)}%` : "—"} danger={data.memPct !== undefined && data.memPct > 85} />
            {data.memPct !== undefined && <MiniBar pct={data.memPct} danger={data.memPct > 85} />}
          </div>
        </div>
        {data.responseLatencyMs !== undefined && (
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[9px] uppercase tracking-wide text-fg-1">Latência OF</span>
            <span className="font-mono text-[10px] text-fg-0">{data.responseLatencyMs.toFixed(1)} ms</span>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-border-0" />
    </>
  );
}

export function SwitchNode(
  props: NodeProps<{
    id: string;
    dpid?: string;
    mgmtIp?: string;
    pktStats?: { rxPps: number; txPps: number; dropPps: number };
  }>,
) {
  const { data } = props;
  const drop = data.pktStats?.dropPps ?? 0;
  return (
    <>
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-border-0" />
      <div className="min-w-[190px] rounded-xl border border-border-0/60 bg-bg-1/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 flex-shrink-0 text-fg-1" />
          <span className="flex-1 truncate font-mono text-[13px] font-bold text-fg-0">{data.id}</span>
          <span className={cn("h-2 w-2 flex-shrink-0 rounded-full", drop > 0 ? "bg-accent-warn" : "bg-accent-ok")} />
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-fg-1">{data.mgmtIp ?? "switch"}</div>
        <div className="mt-2 grid grid-cols-3 gap-x-2">
          <Stat label="RX" value={`${data.pktStats?.rxPps ?? 0}`} />
          <Stat label="TX" value={`${data.pktStats?.txPps ?? 0}`} />
          <Stat label="DROP" value={`${drop}`} danger={drop > 0} />
        </div>
        <div className="mt-1 text-[9px] text-fg-1">pps</div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-border-0" />
    </>
  );
}

export function HostNode(
  props: NodeProps<{
    id: string;
    ip?: string;
    mac?: string;
    mgmtIp?: string;
    cpuPct?: number;
    memPct?: number;
  }>,
) {
  const { data } = props;
  return (
    <>
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-border-0" />
      <div className="min-w-[170px] rounded-xl border border-border-0/60 bg-bg-1/80 px-3 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 flex-shrink-0 text-fg-1" />
          <span className="flex-1 truncate font-mono text-[13px] font-bold text-fg-0">{data.id}</span>
          <span className="h-2 w-2 flex-shrink-0 rounded-full bg-accent-ok" />
        </div>
        <div className="mt-0.5 font-mono text-[10px] text-fg-1">{data.mgmtIp ?? data.ip ?? "host"}</div>
        {(data.cpuPct !== undefined || data.memPct !== undefined) && (
          <div className="mt-2 grid grid-cols-2 gap-x-3">
            <div>
              <Stat label="CPU" value={data.cpuPct !== undefined ? `${data.cpuPct.toFixed(1)}%` : "—"} danger={data.cpuPct !== undefined && data.cpuPct > 80} />
              {data.cpuPct !== undefined && <MiniBar pct={data.cpuPct} danger={data.cpuPct > 80} />}
            </div>
            <div>
              <Stat label="MEM" value={data.memPct !== undefined ? `${data.memPct.toFixed(1)}%` : "—"} danger={data.memPct !== undefined && data.memPct > 85} />
              {data.memPct !== undefined && <MiniBar pct={data.memPct} danger={data.memPct > 85} />}
            </div>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-border-0" />
    </>
  );
}

export const nodeTypes = {
  switch: SwitchNode,
  host: HostNode,
  controller: ControllerNode,
};

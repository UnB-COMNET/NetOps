"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { randomWalk } from "@/lib/sim";

type DeviceRow = {
  name: string;
  ip: string;
  latencyMs: number;
  jitterMs: number;
  cpuPct: number;
};

function seed(): DeviceRow[] {
  return [
    { name: "controller", ip: "10.0.0.10", latencyMs: 6.2, jitterMs: 1.1, cpuPct: 18 },
    { name: "s1", ip: "10.0.0.1", latencyMs: 11.5, jitterMs: 1.8, cpuPct: 22 },
    { name: "s2", ip: "10.0.0.2", latencyMs: 13.1, jitterMs: 2.1, cpuPct: 28 },
    { name: "s3", ip: "10.0.0.3", latencyMs: 16.4, jitterMs: 2.4, cpuPct: 31 },
    { name: "h1", ip: "10.0.0.101", latencyMs: 18.2, jitterMs: 2.7, cpuPct: 12 },
    { name: "h2", ip: "10.0.0.102", latencyMs: 21.9, jitterMs: 3.2, cpuPct: 14 },
  ];
}

export function DeviceStatusTable() {
  const [rows, setRows] = useState<DeviceRow[]>(() => seed());

  useEffect(() => {
    const id = setInterval(() => {
      setRows((prev) =>
        prev.map((r) => ({
          ...r,
          latencyMs: randomWalk(r.latencyMs, 1.8, 0.5, 120),
          jitterMs: randomWalk(r.jitterMs, 0.7, 0.1, 40),
          cpuPct: randomWalk(r.cpuPct, 4.2, 0, 100),
        })),
      );
    }, 900);
    return () => clearInterval(id);
  }, []);

  const maxCpu = useMemo(() => Math.max(...rows.map((r) => r.cpuPct)), [rows]);

  return (
    <Card>
      <CardHeader title="Status de Dispositivos" right={<span className="font-mono">live</span>} />
      <CardBody>
        <div className="overflow-auto rounded-lg border border-border-0/60">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead className="bg-bg-1/60">
              <tr className="border-b border-border-0/60 text-[10px] uppercase tracking-wide text-fg-1">
                <th className="px-2 py-2 font-medium">Nome</th>
                <th className="px-2 py-2 font-medium">IP</th>
                <th className="px-2 py-2 font-medium">Latência</th>
                <th className="px-2 py-2 font-medium">Jitter</th>
                <th className="px-2 py-2 font-medium">Carga CPU</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-border-0/30 hover:bg-bg-2/20">
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-0">{r.name}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{r.ip}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-0">{r.latencyMs.toFixed(1)} ms</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-0">{r.jitterMs.toFixed(1)} ms</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded bg-bg-2/40">
                        <div
                          className="h-2 rounded bg-border-0"
                          style={{ width: `${(r.cpuPct / Math.max(1, maxCpu)) * 100}%` }}
                        />
                      </div>
                      <div className="font-mono text-[11px] text-fg-0">{r.cpuPct.toFixed(0)}%</div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

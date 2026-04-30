"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import type { EntityKind, MetricLayer, MetricSpec } from "@/lib/metricsCatalog";
import { cn } from "@/lib/cn";

export type InventoryRow = {
  node: string;
  entityKind: EntityKind;
  iface: string;
  vrf: string;
  protocol: string;
  layer: MetricLayer;
  category: string;
  type: string;
  metric: string;
  unit: string;
  value: string;
};

function inferProtocol(spec: MetricSpec) {
  if (spec.layer === "L3" || spec.layer === "L4") return spec.key.includes("udp") ? "UDP" : "TCP";
  if (spec.layer === "L5") return "TLS";
  if (spec.layer === "L7") return spec.key.includes("dns") ? "DNS" : "HTTP";
  if (spec.layer === "Control Plane") return "OpenFlow";
  if (spec.layer === "Dataplane") return "OF-DP";
  if (spec.layer === "L1") {
    if (spec.key.includes("stp")) return "STP";
    if (spec.key.includes("vlan")) return "VLAN";
    if (spec.key.includes("lldp")) return "LLDP";
  }
  return "—";
}

function inferInterface(node: string, kind: EntityKind, spec: MetricSpec) {
  const wantsIface =
    spec.key.startsWith("if_") ||
    spec.key.startsWith("port_") ||
    spec.layer === "L0" ||
    spec.layer === "L1";
  if (!wantsIface) return "—";

  if (kind === "controller") return "mgmt0";
  if (kind === "host") return `${node}-eth0`;
  return "eth1";
}

function toCsv(rows: InventoryRow[]) {
  const headers = [
    "node",
    "entityKind",
    "interface",
    "vrf",
    "protocol",
    "layer",
    "category",
    "type",
    "metric",
    "unit",
    "value",
  ];

  const esc = (v: string) => {
    const s = v ?? "";
    if (/[\n\r,\"]/g.test(s)) return `"${s.replaceAll("\"", "\"\"")}"`;
    return s;
  };

  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.node,
        r.entityKind,
        r.iface,
        r.vrf,
        r.protocol,
        r.layer,
        r.category,
        r.type,
        r.metric,
        r.unit,
        r.value,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}

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

export function MetricInventoryTable({
  entityKind,
  entityId,
  specs,
  currentValues,
}: {
  entityKind: EntityKind;
  entityId: string;
  specs: MetricSpec[];
  currentValues: Record<string, string>;
}) {
  const rows = useMemo<InventoryRow[]>(() => {
    return specs.map((spec) => {
      const protocol = inferProtocol(spec);
      const iface = inferInterface(entityId, entityKind, spec);
      return {
        node: entityId,
        entityKind,
        iface,
        vrf: "default",
        protocol,
        layer: spec.layer,
        category: spec.category,
        type: spec.type,
        metric: spec.name,
        unit: spec.unit ?? "—",
        value: currentValues[spec.key] ?? "—",
      };
    });
  }, [currentValues, entityId, entityKind, specs]);

  return (
    <Card>
      <CardHeader
        title="Inventário de Métricas"
        right={
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-fg-1">{rows.length} rows</span>
            <Button
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() =>
                downloadTextFile({
                  filename: `metric-inventory_${entityKind}_${entityId}.csv`,
                  content: toCsv(rows),
                  mime: "text/csv;charset=utf-8",
                })
              }
              disabled={rows.length === 0}
            >
              Exportar CSV
            </Button>
          </div>
        }
      />
      <CardBody>
        <div className="overflow-auto rounded-lg border border-border-0/60">
          <table className="w-full min-w-[1060px] border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-bg-1/70 backdrop-blur">
              <tr className="border-b border-border-0/60 text-[10px] uppercase tracking-wide text-fg-1">
                <th className="px-2 py-2 font-medium">Nó</th>
                <th className="px-2 py-2 font-medium">Tipo</th>
                <th className="px-2 py-2 font-medium">Interface</th>
                <th className="px-2 py-2 font-medium">VRF</th>
                <th className="px-2 py-2 font-medium">Protocolo</th>
                <th className="px-2 py-2 font-medium">Camada</th>
                <th className="px-2 py-2 font-medium">Categoria</th>
                <th className="px-2 py-2 font-medium">Tipo Métrica</th>
                <th className="px-2 py-2 font-medium">Métrica</th>
                <th className="px-2 py-2 font-medium">Unidade</th>
                <th className="px-2 py-2 font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.node}-${r.metric}-${r.layer}`} className="border-b border-border-0/30 hover:bg-bg-2/20">
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-0">{r.node}</td>
                  <td className="px-2 py-2 text-[11px] text-fg-1">{r.entityKind}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{r.iface}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{r.vrf}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{r.protocol}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{r.layer}</td>
                  <td className="px-2 py-2 text-[11px] text-fg-1">{r.category}</td>
                  <td className="px-2 py-2 text-[11px] text-fg-1">{r.type}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-0">{r.metric}</td>
                  <td className="px-2 py-2 font-mono text-[11px] text-fg-1">{r.unit}</td>
                  <td className={cn("px-2 py-2 font-mono text-[11px]", r.value === "0" ? "text-accent-danger" : "text-fg-0")}>
                    {r.value}
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

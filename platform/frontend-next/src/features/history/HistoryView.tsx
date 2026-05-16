"use client";

import { Fragment, useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input, Select } from "@/components/ui/Input";
import { auditRows, type AuditRow } from "@/features/history/data";

export function HistoryView() {
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState<"all" | AuditRow["severity"]>("all");
  const [module, setModule] = useState<"all" | AuditRow["module"]>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return auditRows.filter((r) => {
      if (severity !== "all" && r.severity !== severity) return false;
      if (module !== "all" && r.module !== module) return false;
      if (!query) return true;
      const blob = [r.id, r.ts, r.actor, r.module, r.severity, r.experimentId ?? "", r.summary]
        .join(" ")
        .toLowerCase();
      return blob.includes(query);
    });
  }, [module, q, severity]);

  return (
    <Card>
      <CardHeader title="Histórico e Auditoria" right={<span className="font-mono">dense table</span>} />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="mb-1 text-[11px] font-medium text-fg-1">Busca avançada</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="id, módulo, switch, experimento, texto..." />
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-fg-1">Severidade</div>
            <Select value={severity} onChange={(e) => setSeverity(e.target.value as any)}>
              <option value="all">todas</option>
              <option value="Normal">Normal</option>
              <option value="Emergência">Emergência</option>
            </Select>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-medium text-fg-1">Módulo</div>
            <Select value={module} onChange={(e) => setModule(e.target.value as any)}>
              <option value="all">todos</option>
              <option value="experimentos">experimentos</option>
              <option value="topologia">topologia</option>
              <option value="lab">lab</option>
              <option value="monitor">monitor</option>
              <option value="config">config</option>
            </Select>
          </div>
        </div>

        <div className="overflow-auto rounded-xl border border-border-0/60">
          <table className="w-full min-w-[980px] border-collapse text-left text-[12px]">
            <thead className="sticky top-0 bg-bg-1/70 backdrop-blur">
              <tr className="border-b border-border-0/60 text-[11px] text-fg-1">
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Timestamp</th>
                <th className="px-3 py-2 font-medium">Actor</th>
                <th className="px-3 py-2 font-medium">Módulo</th>
                <th className="px-3 py-2 font-medium">Severidade</th>
                <th className="px-3 py-2 font-medium">Resumo</th>
                <th className="px-3 py-2 font-medium">Ação</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const isOpen = expanded === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className="border-b border-border-0/40 hover:bg-bg-2/20">
                      <td className="px-3 py-2 font-mono text-[11px] text-fg-0">{r.id}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-fg-1">{r.ts}</td>
                      <td className="px-3 py-2 text-fg-1">{r.actor}</td>
                      <td className="px-3 py-2 text-fg-1">{r.module}</td>
                      <td className="px-3 py-2">
                        <Badge tone={r.severity === "Normal" ? "ok" : "danger"}>{r.severity}</Badge>
                      </td>
                      <td className="px-3 py-2 text-fg-1">{r.summary}</td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          onClick={() => setExpanded((p) => (p === r.id ? null : r.id))}
                        >
                          {isOpen ? "Recolher" : "Expandir"}
                        </Button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="border-b border-border-0/40 bg-bg-2/10">
                        <td colSpan={7} className="px-3 py-3">
                          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                            <div className="rounded-lg border border-border-0/60 bg-bg-2/20 p-3">
                              <div className="mb-1 text-[11px] font-medium text-fg-1">Log (JSON)</div>
                              <pre className="max-h-64 overflow-auto text-[11px] leading-relaxed text-fg-0">
                                {JSON.stringify(r.log, null, 2)}
                              </pre>
                            </div>
                            <div className="rounded-lg border border-border-0/60 bg-bg-2/20 p-3">
                              <div className="mb-1 text-[11px] font-medium text-fg-1">Resultados (JSON)</div>
                              <pre className="max-h-64 overflow-auto text-[11px] leading-relaxed text-fg-0">
                                {JSON.stringify(r.results, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-[11px] text-fg-1">
          linhas: <span className="font-mono">{filtered.length}</span>
        </div>
      </CardBody>
    </Card>
  );
}

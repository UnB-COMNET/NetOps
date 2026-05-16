"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { labNodeTypes, type LabBlockData } from "@/features/lab/blockNode";
import { cn } from "@/lib/cn";

type BlockKind = LabBlockData["kind"];

const palette: Array<{ kind: BlockKind; label: string; defaultConfig: Record<string, unknown> }> = [
  { kind: "Filter", label: "Filtro", defaultConfig: { field: "switch_id", op: "eq", value: "s1" } },
  { kind: "Aggregator", label: "Agregador", defaultConfig: { window: "5s", fn: "avg", field: "latency_ms" } },
  { kind: "Mapper", label: "Map", defaultConfig: { expr: "throughput_mbps/8" } },
  { kind: "Threshold", label: "Threshold", defaultConfig: { field: "loss_pct", gt: 1.0 } },
];

function PaletteItem({ kind, label }: { kind: BlockKind; label: string }) {
  return (
    <div
      draggable
      onDragStart={(ev) => {
        ev.dataTransfer.setData("application/netops-labblock", kind);
        ev.dataTransfer.effectAllowed = "move";
      }}
      className={cn(
        "cursor-grab select-none rounded-lg border border-border-0/60 bg-bg-2/30 px-3 py-2",
        "text-[12px] text-fg-0 hover:bg-bg-2/50 active:cursor-grabbing",
      )}
    >
      <div className="font-mono text-[12px] font-semibold">{label}</div>
      <div className="mt-0.5 text-[11px] text-fg-1">{kind}</div>
    </div>
  );
}

function EditorInner() {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes] = useState<Node<LabBlockData>[]>([
    {
      id: "b1",
      type: "block",
      position: { x: 120, y: 150 },
      data: { id: "b1", kind: "Filter", config: { field: "layer", op: "eq", value: "L2" } },
    },
    {
      id: "b2",
      type: "block",
      position: { x: 420, y: 150 },
      data: { id: "b2", kind: "Aggregator", config: { window: "5s", fn: "p95", field: "latency_ms" } },
    },
  ]);
  const [edges, setEdges] = useState<Edge[]>([
    { id: "e1", source: "b1", target: "b2", style: { stroke: "rgb(var(--border-0))" } },
  ]);

  const [selected, setSelected] = useState<Node<LabBlockData> | null>(null);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection }, eds)),
    [],
  );

  const onDragOver = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (ev: React.DragEvent) => {
      ev.preventDefault();
      const kind = ev.dataTransfer.getData("application/netops-labblock") as BlockKind;
      if (!kind) return;

      const bounds = wrapperRef.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = { x: ev.clientX - bounds.left, y: ev.clientY - bounds.top };
      const idx = nodes.length + 1;
      const id = `b${idx}`;
      const base = palette.find((p) => p.kind === kind);

      const node: Node<LabBlockData> = {
        id,
        type: "block",
        position,
        data: { id, kind, config: base?.defaultConfig ?? {} },
      };

      setNodes((prev) => prev.concat(node));
    },
    [nodes.length],
  );

  const onNodeClick = useCallback((_: any, node: Node<LabBlockData>) => setSelected(node), []);

  const updateSelectedConfigKey = useCallback(
    (keyName: string, value: string) => {
      if (!selected) return;
      setNodes((prev) =>
        prev.map((n) =>
          n.id === selected.id
            ? { ...n, data: { ...n.data, config: { ...n.data.config, [keyName]: value } } }
            : n,
        ),
      );
      setSelected((prevSel) =>
        prevSel
          ? { ...prevSel, data: { ...prevSel.data, config: { ...prevSel.data.config, [keyName]: value } } }
          : prevSel,
      );
    },
    [selected],
  );

  const canvas = useMemo(
    () => (
      <div ref={wrapperRef} className="h-[72vh] w-full overflow-hidden rounded-xl border border-border-0/60">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={labNodeTypes}
          onNodeClick={onNodeClick}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          fitView
        >
          <Background gap={18} size={1} color="rgba(40,49,73,0.9)" />
          <Controls />
        </ReactFlow>
      </div>
    ),
    [edges, nodes, onConnect, onDragOver, onDrop, onNodeClick],
  );

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_340px]">
      <Card>
        <CardHeader title="Paleta" right={<span className="font-mono">blocks</span>} />
        <CardBody className="space-y-3">
          {palette.map((p) => (
            <PaletteItem key={p.kind} kind={p.kind} label={p.label} />
          ))}
          <div className="pt-1 text-[11px] text-fg-1">Conecte blocos para definir o fluxo.</div>
        </CardBody>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14px] font-semibold tracking-tight">LAB Low-Code</div>
            <div className="text-[11px] text-fg-1">Node-based editor (estilo GNURadio)</div>
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setSelected(null);
              setNodes([]);
              setEdges([]);
            }}
          >
            Limpar
          </Button>
        </div>
        {canvas}
      </div>

      <Card>
        <CardHeader title="Propriedades" right={<span className="font-mono">block</span>} />
        <CardBody className="space-y-3">
          {!selected ? (
            <div className="text-[12px] text-fg-1">Clique em um bloco para editar.</div>
          ) : (
            <>
              <div className="text-[11px] text-fg-1">
                Selecionado: <span className="font-mono text-fg-0">{selected.data.id}</span> ·{" "}
                <span className="font-mono text-fg-0">{selected.data.kind}</span>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-fg-1">Config key</div>
                <Input
                  placeholder="ex: field"
                  defaultValue={Object.keys(selected.data.config)[0] ?? "field"}
                  onBlur={(e) => {
                    const oldKey = Object.keys(selected.data.config)[0];
                    if (!oldKey) return;
                    const nextKey = e.target.value.trim();
                    if (!nextKey || nextKey === oldKey) return;
                    setNodes((prev) =>
                      prev.map((n) => {
                        if (n.id !== selected.id) return n;
                        const cfg = { ...n.data.config };
                        cfg[nextKey] = cfg[oldKey];
                        delete cfg[oldKey];
                        return { ...n, data: { ...n.data, config: cfg } };
                      }),
                    );
                  }}
                />
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-fg-1">Config value</div>
                <Input
                  placeholder="ex: latency_ms"
                  onChange={(e) => {
                    const key = Object.keys(selected.data.config)[0] ?? "field";
                    updateSelectedConfigKey(key, e.target.value);
                  }}
                />
              </div>
              <div className="rounded-lg border border-border-0/60 bg-bg-2/20 p-3">
                <div className="mb-1 text-[11px] font-medium text-fg-1">Preview (JSON)</div>
                <pre className="max-h-64 overflow-auto text-[11px] leading-relaxed">
                  {JSON.stringify(selected.data, null, 2)}
                </pre>
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function LabEditor() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}

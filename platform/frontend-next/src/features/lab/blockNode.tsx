"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import { cn } from "@/lib/cn";

export type LabBlockData = {
  id: string;
  kind: "Filter" | "Aggregator" | "Mapper" | "Threshold";
  config: Record<string, unknown>;
};

export function BlockNode({ data }: NodeProps<LabBlockData>) {
  return (
    <div className={cn("min-w-[190px] rounded-xl border border-border-0/60 bg-bg-1/60 px-3 py-2")}> 
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-0 !bg-border-0" />
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-[12px] font-semibold text-fg-0">{data.kind}</div>
        <div className="text-[10px] text-fg-1">{data.id}</div>
      </div>
      <div className="mt-0.5 truncate font-mono text-[10px] text-fg-1">
        {Object.keys(data.config).slice(0, 3).join(" · ") || "config"}
      </div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-0 !bg-border-0" />
    </div>
  );
}

export const labNodeTypes = {
  block: BlockNode,
};

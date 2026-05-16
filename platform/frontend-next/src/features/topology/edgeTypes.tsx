"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from "reactflow";

import { cn } from "@/lib/cn";

export type LinkStatus = {
  mode: "physical" | "logical";
  utilPct?: number;
  capacityMbps?: number;
  lossPct?: number;
  up?: boolean;
  trace?: boolean;
};

function fmtCapacity(mbps?: number) {
  if (!mbps || mbps <= 0) return "—";
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(0)}Gbps`;
  return `${mbps.toFixed(0)}Mbps`;
}

export function UtilEdge(props: EdgeProps<LinkStatus>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, data } = props;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const up = data?.up ?? true;
  const loss = data?.lossPct ?? 0;
  const trace = data?.trace ?? false;

  const danger = !up || loss >= 2.5;

  const stroke = trace
    ? "rgb(var(--accent-ok))"
    : danger
      ? "rgb(var(--accent-danger))"
      : data?.mode === "logical"
        ? "rgb(var(--fg-1))"
        : "rgb(var(--border-0))";

  const dash = !up ? "2 6" : loss >= 2.5 ? "6 4" : undefined;

  const labelText = (() => {
    if (data?.mode !== "physical") return null;
    const utilTxt = `${(data?.utilPct ?? 0).toFixed(0)}%/${fmtCapacity(data?.capacityMbps)}`;
    if (!up) return `DOWN · ${utilTxt}`;
    if (loss >= 2.5) return `LOSS ${(loss).toFixed(2)}% · ${utilTxt}`;
    return utilTxt;
  })();

  return (
    <>
      {/* Halo (improves contrast behind dashed lines and labels) */}
      <BaseEdge
        id={`${id}-halo`}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...(style ?? {}),
          stroke: "rgb(var(--bg-0))",
          strokeWidth: trace ? 7.0 : danger ? 6.0 : 5.0,
          opacity: trace ? 0.28 : danger ? 0.22 : 0.16,
        }}
      />

      <g className={cn(danger && !trace && "animate-pulse")}>
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          style={{
            ...(style ?? {}),
            stroke,
            strokeWidth: trace ? 3.0 : danger ? 2.8 : 2.2,
            strokeDasharray: dash,
            opacity: trace ? 0.95 : danger ? 0.96 : 0.88,
          }}
        />
      </g>

      {labelText ? (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "pointer-events-none absolute -translate-x-1/2 -translate-y-1/2",
              "rounded-md border border-border-0/60 bg-bg-0/80 px-2 py-1",
              "text-[10px] text-fg-0 backdrop-blur",
              danger && "border-accent-danger/40 text-accent-danger",
              trace && "border-accent-ok/40 text-accent-ok",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <span className="font-mono">
              {trace ? "TRACE · " : ""}{labelText}
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const edgeTypes = {
  util: UtilEdge,
};

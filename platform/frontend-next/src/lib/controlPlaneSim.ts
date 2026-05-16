export type ControlPlaneEvent = {
  ts: string;
  type: "PACKET_IN" | "FLOW_MOD" | "PACKET_OUT" | "PORT_STATUS" | "STATS_REPLY";
  datapathId: string;
  summary: string;
};

function makeRng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const DPIDS = [
  "00:00:00:00:00:00:00:01",
  "00:00:00:00:00:00:00:02",
  "00:00:00:00:00:00:00:03",
];

export function simulateControlPlaneLog({
  startedAtMs,
  durationMs,
  samplingMs,
  seed,
}: {
  startedAtMs: number;
  durationMs: number;
  samplingMs: number;
  seed: number;
}): ControlPlaneEvent[] {
  const rnd = makeRng(seed);
  const n = Math.max(4, Math.min(800, Math.round(durationMs / Math.max(50, samplingMs))));
  const events: ControlPlaneEvent[] = [];

  for (let i = 0; i < n; i++) {
    const tMs = Math.round((i / Math.max(1, n - 1)) * durationMs);
    const ts = new Date(startedAtMs + tMs).toISOString();
    const dpid = DPIDS[Math.floor(rnd() * DPIDS.length)] ?? DPIDS[0]!;

    const p = rnd();
    let type: ControlPlaneEvent["type"] = "STATS_REPLY";
    if (p < 0.34) type = "PACKET_IN";
    else if (p < 0.62) type = "FLOW_MOD";
    else if (p < 0.78) type = "PACKET_OUT";
    else if (p < 0.9) type = "PORT_STATUS";

    const summary =
      type === "PACKET_IN"
        ? `in_port=${1 + Math.floor(rnd() * 4)} · eth_type=0x0800 · reason=NO_MATCH`
        : type === "FLOW_MOD"
          ? `table=0 · prio=${100 + Math.floor(rnd() * 900)} · match=ipv4,tcp · action=output:${1 + Math.floor(rnd() * 4)}`
          : type === "PACKET_OUT"
            ? `actions=output:${1 + Math.floor(rnd() * 4)} · len=${64 + Math.floor(rnd() * 900)}`
            : type === "PORT_STATUS"
              ? `port=${1 + Math.floor(rnd() * 4)} · state=${rnd() < 0.08 ? "DOWN" : "UP"}`
              : `reply=port_stats · ports=${1 + Math.floor(rnd() * 8)}`;

    events.push({ ts, type, datapathId: dpid, summary });
  }

  return events;
}

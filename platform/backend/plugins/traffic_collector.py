from __future__ import annotations

from typing import Any, Dict, List, Mapping, MutableSequence, Sequence

from platform.backend.core.metrics import ensure_labels, to_metric_sample
from platform.backend.core.plugins import MetricCollector
from platform.backend.core.registry import registry
from platform.backend.core.sinks import TimeseriesSink
from platform.backend.core.traffic_parsers import parse_iperf_output, parse_ping_output
from platform.backend.schemas import MetricSample


def _context_labels(context: Mapping[str, Any]) -> Dict[str, Any]:
    return {k: context.get(k) for k in ["experiment_id", "run_id", "topology_id", "version", "src", "dst", "collector"] if context.get(k) is not None}


class TrafficToolCollector:
    """Normalizes CLI/tool outputs (ping/iperf) into structured metric samples."""

    def __init__(self, *, name: str = "traffic_tools", sink: TimeseriesSink | None = None) -> None:
        self._name = name
        self._sink = sink or TimeseriesSink()

    def name(self) -> str:
        return self._name

    def supported_metrics(self) -> list[str]:
        return ["latency_ms", "jitter_ms", "packet_loss_pct", "throughput_mbps", "bandwidth_mbps"]

    async def start(self, context: Dict[str, Any]) -> None:
        return None

    async def collect(self, context: Dict[str, Any]) -> Dict[str, Any]:
        labels = ensure_labels(_context_labels(context))
        samples: MutableSequence[MetricSample] = []

        # Ping outputs can be provided as str or mapping of node->output
        ping_outputs = context.get("ping_output") or {}
        if isinstance(ping_outputs, str):
            samples.extend(parse_ping_output(ping_outputs, node=context.get("src") or "ping", labels=labels))
        elif isinstance(ping_outputs, Mapping):
            for node_id, output in ping_outputs.items():
                samples.extend(parse_ping_output(str(output), node=node_id, labels=labels))

        # iperf JSON/text payloads
        iperf_outputs = context.get("iperf_output") or {}
        if isinstance(iperf_outputs, (str, Mapping)):
            iperf_map = {context.get("src") or "client": iperf_outputs}
        else:
            iperf_map = {}
        if isinstance(iperf_outputs, Mapping):
            iperf_map = iperf_outputs
        for client, payload in iperf_map.items():
            dst = context.get("dst") or context.get("server") or "server"
            samples.extend(parse_iperf_output(payload, client=client, server=dst, labels=labels))

        # Optional static bandwidth hints
        bandwidth = context.get("bandwidth_mbps")
        if isinstance(bandwidth, (int, float)):
            node = context.get("link") or context.get("src") or "link"
            samples.append(to_metric_sample("bandwidth_mbps", node, float(bandwidth), layer="link", labels=labels))

        written = self._sink.write_samples(list(samples))
        return {"collected": len(samples), "written": written}

    async def stop(self, context: Dict[str, Any]) -> None:
        return None


tool_collector = TrafficToolCollector()
registry.register_metric_collector(tool_collector)

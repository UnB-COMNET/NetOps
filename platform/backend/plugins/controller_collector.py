from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Mapping, MutableSequence, Sequence

import httpx

from platform.backend.core.metrics import ensure_labels, to_metric_sample
from platform.backend.core.plugins import MetricCollector
from platform.backend.core.registry import registry
from platform.backend.core.sinks import TimeseriesSink
from platform.backend.schemas import MetricLayer, MetricSample


def _context_labels(context: Mapping[str, Any]) -> Dict[str, Any]:
    labels = {k: context.get(k) for k in ["experiment_id", "run_id", "topology_id", "version", "src", "dst"] if context.get(k) is not None}
    collector_name = context.get("collector")
    if collector_name:
        labels["collector"] = collector_name
    return labels


def _flatten_metrics(prefix: str, payload: Mapping[str, Any], *, node: str, labels: Mapping[str, Any]) -> List[MetricSample]:
    samples: List[MetricSample] = []
    for key, val in payload.items():
        metric_key = f"{prefix}_{key}" if prefix else key
        if isinstance(val, (int, float)):
            samples.append(
                to_metric_sample(
                    metric=metric_key,
                    node=node,
                    layer="control",
                    value=float(val),
                    labels=labels,
                    details={"source": "controller_api"},
                )
            )
        elif isinstance(val, Mapping):
            samples.extend(_flatten_metrics(metric_key, val, node=node, labels=labels))
    return samples


class ControllerMetricCollector:
    """Polls controller REST endpoints and accepts push-style payloads."""

    def __init__(self, *, name: str = "controller", timeout: float = 6.0, sink: TimeseriesSink | None = None) -> None:
        self._name = name
        self._timeout = timeout
        self._sink = sink or TimeseriesSink()
        self._client: httpx.AsyncClient | None = None

    def name(self) -> str:
        return self._name

    def supported_metrics(self) -> list[str]:
        return [
            "controller_latency_ms",
            "controller_conn_ok",
            "openflow_flow_packets",
            "openflow_flow_bytes",
            "table_hits",
            "table_misses",
        ]

    async def start(self, context: Dict[str, Any]) -> None:
        if not self._client:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        await asyncio.sleep(0)

    async def collect(self, context: Dict[str, Any]) -> Dict[str, Any]:
        labels = ensure_labels(_context_labels(context))
        controller = context.get("controller", {}) or {}
        base_url = controller.get("base_url")
        endpoints: Sequence[str] = controller.get("endpoints", []) or []
        node_id = controller.get("id") or controller.get("name") or "controller"

        samples: MutableSequence[MetricSample] = []
        if self._client and base_url and endpoints:
            for ep in endpoints:
                url = f"{base_url.rstrip('/')}/{ep.lstrip('/')}"
                try:
                    resp = await self._client.get(url)
                    if resp.is_success:
                        if resp.headers.get("content-type", "").startswith("application/json"):
                            payload = resp.json()
                            samples.extend(_flatten_metrics("", payload, node=node_id, labels=labels))
                        else:
                            # Plain numeric response fallback
                            try:
                                value = float(resp.text.strip())
                                samples.append(
                                    to_metric_sample(
                                        metric=ep.replace("/", "_"),
                                        node=node_id,
                                        layer="control",
                                        value=value,
                                        labels=labels,
                                        details={"source": "controller_api"},
                                    )
                                )
                            except ValueError:
                                continue
                except (httpx.HTTPError, OSError):
                    continue

        # Accept push samples provided by upstream components
        push_samples = context.get("push_samples") or []
        for payload in push_samples:
            if isinstance(payload, MetricSample):
                samples.append(payload)
            elif isinstance(payload, Mapping):
                metric = payload.get("metric")
                value = payload.get("value")
                node = payload.get("node") or node_id
                layer: MetricLayer = payload.get("layer") or "control"
                if metric is not None and value is not None and node:
                    samples.append(
                        to_metric_sample(
                            metric=metric,
                            node=node,
                            layer=layer,
                            value=float(value),
                            labels=labels,
                            details=payload.get("details") or {},
                        )
                    )

        written = self._sink.write_samples(list(samples))
        return {"collected": len(samples), "written": written}

    async def stop(self, context: Dict[str, Any]) -> None:
        if self._client:
            await self._client.aclose()
            self._client = None
        await asyncio.sleep(0)


class HostMetricCollector:
    """Collects host/switch resource stats provided in context or via psutil fallback."""

    def __init__(self, *, name: str = "host", sink: TimeseriesSink | None = None) -> None:
        self._name = name
        self._sink = sink or TimeseriesSink()

    def name(self) -> str:
        return self._name

    def supported_metrics(self) -> list[str]:
        return ["cpu_util_pct", "mem_util_pct", "link_util_pct", "packet_loss_pct"]

    async def start(self, context: Dict[str, Any]) -> None:
        await asyncio.sleep(0)

    async def collect(self, context: Dict[str, Any]) -> Dict[str, Any]:
        labels = ensure_labels(_context_labels(context))
        hosts: Sequence[Mapping[str, Any]] = context.get("hosts", []) or []
        samples: List[MetricSample] = []

        for host in hosts:
            node_id = host.get("id") or host.get("name") or "host"
            stats = host.get("stats") or {}
            if "cpu_pct" in stats:
                samples.append(to_metric_sample("cpu_util_pct", node_id, stats["cpu_pct"], layer="control", labels=labels))
            if "mem_pct" in stats:
                samples.append(to_metric_sample("mem_util_pct", node_id, stats["mem_pct"], layer="control", labels=labels))
            link_util = stats.get("link_util_pct")
            if isinstance(link_util, (int, float)):
                samples.append(to_metric_sample("link_util_pct", node_id, link_util, layer="link", labels=labels))
            loss = stats.get("packet_loss_pct")
            if isinstance(loss, (int, float)):
                samples.append(to_metric_sample("packet_loss_pct", node_id, loss, layer="network", labels=labels))

        written = self._sink.write_samples(samples)
        return {"collected": len(samples), "written": written}

    async def stop(self, context: Dict[str, Any]) -> None:
        await asyncio.sleep(0)


controller_collector = ControllerMetricCollector()
host_collector = HostMetricCollector()
registry.register_metric_collector(controller_collector)
registry.register_metric_collector(host_collector)

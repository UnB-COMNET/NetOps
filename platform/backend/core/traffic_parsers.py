from __future__ import annotations

import json
import re
from typing import Any, Dict, Iterable, List, Mapping, Sequence

from platform.backend.core.metrics import to_metric_sample
from platform.backend.schemas import MetricSample


PING_LOSS_RE = re.compile(r"(?P<loss>[0-9]+(?:\.[0-9]+)?)%\s*packet loss", re.IGNORECASE)
PING_RTT_RE = re.compile(r"=\s*(?P<min>[0-9.]+)/(?P<avg>[0-9.]+)/(?P<max>[0-9.]+)/(?P<mdev>[0-9.]+)")
PING_TIME_RE = re.compile(r"time=(?P<time>[0-9.]+)")


def parse_ping_output(output: str, *, node: str, labels: Mapping[str, Any]) -> List[MetricSample]:
    samples: List[MetricSample] = []
    loss = PING_LOSS_RE.search(output)
    if loss:
        loss_pct = float(loss.group("loss"))
        samples.append(to_metric_sample("packet_loss_pct", node, loss_pct, layer="network", labels=labels))
    rtt = PING_RTT_RE.search(output)
    jitter_ms = float(rtt.group("mdev")) if rtt else None
    avg = float(rtt.group("avg")) if rtt else None
    if avg is None:
        times = [float(m.group("time")) for m in PING_TIME_RE.finditer(output)]
        if times:
            avg = sum(times) / len(times)
    if avg is not None:
        samples.append(to_metric_sample("latency_ms", node, avg, layer="network", labels=labels))
    if jitter_ms is not None:
        samples.append(to_metric_sample("jitter_ms", node, jitter_ms, layer="network", labels=labels))
    return samples


def _coerce_iperf_payload(payload: Any) -> Dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return {}


def parse_iperf_output(payload: Any, *, client: str, server: str, labels: Mapping[str, Any]) -> List[MetricSample]:
    data = _coerce_iperf_payload(payload)
    samples: List[MetricSample] = []
    summary = data.get("end", {}) if isinstance(data, dict) else {}
    sum_received = summary.get("sum_received") or summary.get("sum") or {}
    sum_sent = summary.get("sum_sent") or {}

    def _bps_to_mbps(value: Any) -> float:
        try:
            return float(value) / 1_000_000.0
        except (TypeError, ValueError):
            return 0.0

    recv_mbps = _bps_to_mbps(sum_received.get("bits_per_second"))
    send_mbps = _bps_to_mbps(sum_sent.get("bits_per_second"))
    if recv_mbps:
        samples.append(
            to_metric_sample(
                "throughput_mbps",
                node=client,
                layer="transport",
                value=recv_mbps,
                labels={**labels, "dst": server},
                details={"direction": "recv"},
            )
        )
    if send_mbps:
        samples.append(
            to_metric_sample(
                "throughput_mbps",
                node=client,
                layer="transport",
                value=send_mbps,
                labels={**labels, "dst": server},
                details={"direction": "send"},
            )
        )

    jitter_ms = sum_received.get("jitter_ms") or summary.get("jitter_ms")
    if jitter_ms is not None:
        try:
            samples.append(to_metric_sample("jitter_ms", client, float(jitter_ms), layer="transport", labels=labels))
        except ValueError:
            pass
    loss_pct = sum_received.get("lost_percent")
    if loss_pct is not None:
        try:
            samples.append(to_metric_sample("packet_loss_pct", client, float(loss_pct), layer="transport", labels=labels))
        except ValueError:
            pass
    return samples

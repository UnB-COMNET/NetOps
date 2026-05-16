from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Iterable, Mapping, Optional, Sequence

from platform.backend.schemas import MetricDefinition, MetricLayer, MetricRecord, MetricSample

# Minimal baseline of metrics expected across collectors.
MINIMAL_METRIC_DEFINITIONS: Sequence[MetricDefinition] = (
    MetricDefinition(name="bandwidth_mbps", description="Provisioned link bandwidth", unit="Mbps", layer="link"),
    MetricDefinition(name="throughput_mbps", description="Measured throughput", unit="Mbps", layer="transport"),
    MetricDefinition(name="latency_ms", description="End-to-end latency", unit="ms", layer="network"),
    MetricDefinition(name="jitter_ms", description="Latency jitter", unit="ms", layer="network"),
    MetricDefinition(name="packet_loss_pct", description="Packet loss percentage", unit="%", layer="network"),
    MetricDefinition(name="cpu_util_pct", description="CPU utilization", unit="%", layer="control"),
    MetricDefinition(name="mem_util_pct", description="Memory utilization", unit="%", layer="control"),
    MetricDefinition(name="flow_bytes", description="Flow byte counter", unit="bytes", layer="dataplane"),
    MetricDefinition(name="flow_packets", description="Flow packet counter", unit="packets", layer="dataplane"),
    MetricDefinition(name="flow_duration_sec", description="Flow duration", unit="seconds", layer="dataplane"),
)

# Default label keys to keep observability data linkable to experiments.
REQUIRED_LABEL_KEYS: Sequence[str] = (
    "experiment_id",
    "run_id",
    "topology_id",
    "src",
    "dst",
    "collector",
    "version",
)


def ensure_labels(labels: Optional[Mapping[str, Any]], required: Iterable[str] = REQUIRED_LABEL_KEYS) -> Dict[str, Any]:
    """Return a label dict with required keys present (filled with None when missing)."""
    base = {key: None for key in required}
    if labels:
        for key, value in labels.items():
            base[key] = value
    return base


def to_metric_record(
    metric: str,
    value: float,
    *,
    timestamp: Optional[datetime] = None,
    labels: Optional[Mapping[str, Any]] = None,
    layer: Optional[MetricLayer] = None,
    details: Optional[Mapping[str, Any]] = None,
) -> MetricRecord:
    ts = timestamp or datetime.utcnow()
    return MetricRecord(
        timestamp=ts,
        metric_name=metric,
        value=float(value),
        layer=layer,
        labels=ensure_labels(labels),
        details=dict(details or {}),
    )


def to_metric_sample(
    metric: str,
    node: str,
    value: float,
    *,
    layer: MetricLayer,
    timestamp: Optional[datetime] = None,
    labels: Optional[Mapping[str, Any]] = None,
    details: Optional[Mapping[str, Any]] = None,
) -> MetricSample:
    ts = timestamp or datetime.utcnow()
    return MetricSample(
        timestamp=ts,
        node=node,
        layer=layer,
        metric=metric,
        value=float(value),
        details=dict(details or {}),
        labels=ensure_labels(labels),
    )

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class TopologyNode(BaseModel):
    id: str
    type: Literal["host", "switch", "controller"]
    mgmt_ip: Optional[str] = None
    image: Optional[str] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class TopologyLink(BaseModel):
    source: str
    target: str
    bandwidth_mbps: Optional[float] = None
    delay_ms: Optional[float] = None
    loss_pct: Optional[float] = None
    meta: Dict[str, Any] = Field(default_factory=dict)


class Topology(BaseModel):
    id: str
    name: str
    controller: Optional[str] = None
    nodes: List[TopologyNode]
    links: List[TopologyLink]
    meta: Dict[str, Any] = Field(default_factory=dict)


class TrafficPattern(BaseModel):
    generator: Literal["iperf", "ping", "custom"]
    src: str
    dst: str
    protocol: Literal["tcp", "udp", "icmp"]
    rate: Optional[str] = None  # e.g., "100Mbps"
    duration_sec: int = 30
    params: Dict[str, str] = Field(default_factory=dict)


class MetricsSet(BaseModel):
    metrics: List[str]
    interval_sec: float = 5.0
    labels: List[str] = Field(default_factory=lambda: ["experiment_id", "run_id", "topology_id"])


class Experiment(BaseModel):
    id: str
    topology_id: str
    name: str
    description: Optional[str] = None
    hypotheses: Optional[str] = None
    traffic: List[TrafficPattern]
    metrics: MetricsSet
    duration_sec: int
    tags: List[str] = Field(default_factory=list)
    template_version: Optional[str] = None


class ExperimentTemplate(BaseModel):
    version: str
    topology: Topology
    experiments: List[Experiment]


class User(BaseModel):
    id: str
    email: str
    role: Literal["admin", "user"] = "user"
    is_active: bool = True
    meta: Dict[str, Any] = Field(default_factory=dict)


class TopologyCreate(BaseModel):
    name: str
    controller: Optional[str] = None
    nodes: List[TopologyNode]
    links: List[TopologyLink]
    meta: Dict[str, str] = Field(default_factory=dict)


class TopologyUpdate(BaseModel):
    name: Optional[str] = None
    controller: Optional[str] = None
    nodes: Optional[List[TopologyNode]] = None
    links: Optional[List[TopologyLink]] = None
    meta: Optional[Dict[str, str]] = None


class ExperimentCreate(BaseModel):
    topology_id: str
    name: str
    description: Optional[str] = None
    hypotheses: Optional[str] = None
    traffic: List[TrafficPattern]
    metrics: MetricsSet
    duration_sec: int
    tags: List[str] = Field(default_factory=list)
    template_version: Optional[str] = None


class ExperimentUpdate(BaseModel):
    topology_id: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    hypotheses: Optional[str] = None
    traffic: Optional[List[TrafficPattern]] = None
    metrics: Optional[MetricsSet] = None
    duration_sec: Optional[int] = None
    tags: Optional[List[str]] = None
    template_version: Optional[str] = None


class ExperimentRun(BaseModel):
    id: str
    experiment_id: str
    topology_id: str
    status: Literal["CREATED", "SCHEDULED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]
    started_at: datetime
    ended_at: Optional[datetime] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    logs: List[str] = Field(default_factory=list)
    meta: Dict[str, Any] = Field(default_factory=dict)


class FlowRule(BaseModel):
    id: Optional[str] = None
    topology_id: str
    controller: Optional[str] = None
    match: Dict[str, str] = Field(default_factory=dict)
    actions: Dict[str, str] = Field(default_factory=dict)
    priority: int = 100
    meta: Dict[str, Any] = Field(default_factory=dict)


MetricLayer = Literal[
    # OSI / service layers
    "service",  # layer 0 (E2E experience)
    "physical",  # L1
    "link",  # L2
    "network",  # L3
    "transport",  # L4
    "session",  # L5
    "presentation",  # L6
    "application",  # L7
    # Platform-specific planes
    "control",
    "dataplane",
]


MetricKind = Literal[
    "gauge",
    "counter",
    "ratio",
    "histogram",
    "summary",
    "derived",
]


class MetricDefinition(BaseModel):
    name: str
    description: str
    unit: Optional[str] = None
    layer: Optional[MetricLayer] = None
    kind: Optional[MetricKind] = None
    osi_layer: Optional[int] = Field(default=None, ge=0, le=7)
    category: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    dimensions: List[str] = Field(default_factory=list)


class MetricRecord(BaseModel):
    timestamp: datetime
    metric_name: str
    value: float
    layer: Optional[MetricLayer] = None
    node: Optional[str] = None
    labels: Dict[str, Any] = Field(default_factory=dict)
    details: Dict[str, Any] = Field(default_factory=dict)


class MetricSample(BaseModel):
    timestamp: datetime
    node: str
    layer: MetricLayer
    metric: str
    value: float
    details: Dict[str, Any] = Field(default_factory=dict)
    labels: Dict[str, Any] = Field(default_factory=dict)


class MetricQuery(BaseModel):
    run_id: Optional[str] = None
    metric_names: Optional[List[str]] = None
    nodes: Optional[List[str]] = None
    layers: Optional[List[MetricLayer]] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    limit: int = 500

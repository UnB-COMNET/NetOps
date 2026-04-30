from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Set

from platform.backend.schemas import (
    FlowRule,
    MetricDefinition,
    MetricLayer,
    Topology,
    TopologyLink,
    TopologyNode,
)

ALLOWED_CONTROLLER_TYPES: Set[str] = {"ryu", "onos", "odl", "floodlight"}


def load_platform_config(path: str) -> Dict:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(f"platform config not found at {config_path}")
    with config_path.open(encoding="utf-8") as f:
        cfg = json.load(f)
    validate_config(cfg)
    return cfg


def _safe_id_from_name(name: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9_-]+", "_", name.strip()).strip("_").lower()
    return slug or "topology"


def validate_config(cfg: Dict) -> None:
    nodes = cfg.get("nodes", [])
    node_ids = [n.get("id") for n in nodes]
    if None in node_ids or len(set(node_ids)) != len(node_ids):
        raise ValueError("nodes must have unique, non-empty ids")

    for node in nodes:
        role = node.get("role") or node.get("type")
        if role not in {"host", "switch", "controller"}:
            raise ValueError(f"invalid node role/type: {role}")

    controllers = cfg.get("controllers", [])
    ctrl_ids = set()
    for ctrl in controllers:
        ctrl_id = ctrl.get("id")
        if not ctrl_id:
            raise ValueError("controller entries require id")
        if ctrl_id in ctrl_ids:
            raise ValueError(f"duplicate controller id: {ctrl_id}")
        ctrl_ids.add(ctrl_id)
        ctrl_type = ctrl.get("type")
        if ctrl_type not in ALLOWED_CONTROLLER_TYPES:
            raise ValueError(f"controller type '{ctrl_type}' not supported")

    default_ctrl = cfg.get("default_controller")
    if default_ctrl and controllers and default_ctrl not in ctrl_ids:
        raise ValueError("default_controller must reference an id in controllers")

    links = cfg.get("links", [])
    for link in links:
        if link.get("source") not in node_ids or link.get("target") not in node_ids:
            raise ValueError("link endpoints must reference existing node ids")

    flow_templates = cfg.get("flow_templates", [])
    for flow in flow_templates:
        ctrl_ref = flow.get("controller")
        if ctrl_ids and ctrl_ref and ctrl_ref not in ctrl_ids:
            raise ValueError(f"flow template controller '{ctrl_ref}' not in controllers list")
        if not ctrl_ids and ctrl_ref and ctrl_ref not in ALLOWED_CONTROLLER_TYPES:
            raise ValueError(f"flow template controller type '{ctrl_ref}' not supported")

    metric_plan = cfg.get("metric_plan")
    if metric_plan:
        metrics = metric_plan.get("metrics")
        if not metrics or not isinstance(metrics, list):
            raise ValueError("metric_plan.metrics must be a non-empty list when provided")

    layers_cfg = cfg.get("metric_layers")
    if layers_cfg and not isinstance(layers_cfg, dict):
        raise ValueError("metric_layers must be an object with boolean flags")
    if layers_cfg:
        for layer_name, enabled in layers_cfg.items():
            if layer_name not in {
                "service",
                "physical",
                "link",
                "network",
                "transport",
                "session",
                "presentation",
                "application",
                "control",
                "dataplane",
            }:
                raise ValueError(f"unsupported metric layer flag: {layer_name}")
            if not isinstance(enabled, bool):
                raise ValueError("metric_layers flags must be boolean")


def topology_from_config(cfg: Dict) -> Optional[Topology]:
    topo_name = cfg.get("name") or cfg.get("topology_name") or "platform-topology"
    topo_id = cfg.get("topology_id") or _safe_id_from_name(topo_name)
    nodes_cfg = cfg.get("nodes", [])
    links_cfg = cfg.get("links", [])
    controllers = cfg.get("controllers", [])
    default_controller = cfg.get("default_controller")

    nodes: List[TopologyNode] = []
    for node in nodes_cfg:
        role = node.get("role") or node.get("type")
        if role not in {"host", "switch", "controller"}:
            continue
        node_meta = {k: v for k, v in node.get("meta", {}).items()}
        if node.get("container_name"):
            node_meta.setdefault("container_name", node.get("container_name"))
        nodes.append(
            TopologyNode(
                id=node["id"],
                type=role,  # type aligns to TopologyNode Literal
                mgmt_ip=node.get("mgmt_ip"),
                image=node.get("image"),
                meta=node_meta,
            )
        )

    links: List[TopologyLink] = []
    for link in links_cfg:
        links.append(
            TopologyLink(
                source=link["source"],
                target=link["target"],
                bandwidth_mbps=link.get("bandwidth_mbps"),
                delay_ms=link.get("delay_ms"),
                loss_pct=link.get("loss_pct"),
                meta={k: v for k, v in link.get("meta", {}).items()},
            )
        )

    # Prefer controller id; fallback to legacy controller.type.
    controller = default_controller
    if controller is None and controllers:
        controller = controllers[0].get("id")
    if controller is None:
        controller = cfg.get("controller", {}).get("type")

    meta = cfg.get("metadata", {})
    if controllers:
        meta = {**meta, "controllers": controllers}

    return Topology(id=topo_id, name=topo_name, controller=controller, nodes=nodes, links=links, meta=meta)


def flows_from_config(cfg: Dict, topology_id: str, controller_ids: Optional[Set[str]] = None) -> List[FlowRule]:
    templates = cfg.get("flow_templates", [])
    flows: List[FlowRule] = []
    for tpl in templates:
        ctrl = tpl.get("controller")
        if controller_ids and ctrl and ctrl not in controller_ids:
            continue
        flows.append(
            FlowRule(
                id=None,
                topology_id=topology_id,
                controller=ctrl,
                match=tpl.get("match", {}),
                actions=tpl.get("actions", {}),
                priority=tpl.get("priority", 100),
                meta={k: v for k, v in tpl.get("meta", {}).items()},
            )
        )
    return flows


def metric_definitions_from_config(cfg: Dict) -> Optional[List[MetricDefinition]]:
    plan = cfg.get("metric_plan")
    if not plan:
        return None
    metrics = plan.get("metrics")
    if not metrics:
        return None
    layer_map = plan.get("metric_layers", {})
    return [
        MetricDefinition(
            name=name,
            description=name,
            unit=None,
            layer=layer_map.get(name),
        )
        for name in metrics
    ]


def metric_layer_flags(cfg: Dict) -> Dict[MetricLayer, bool]:
    defaults: Dict[MetricLayer, bool] = {
        "service": True,
        "physical": True,
        "link": True,
        "network": True,
        "transport": True,
        "session": True,
        "presentation": True,
        "application": True,
        "control": True,
        "dataplane": True,
    }
    overrides = cfg.get("metric_layers", {}) if isinstance(cfg.get("metric_layers"), dict) else {}
    return {**defaults, **overrides}

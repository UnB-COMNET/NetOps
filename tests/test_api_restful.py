from __future__ import annotations

import importlib
import json
from typing import Dict

from fastapi.testclient import TestClient

CONFIG_DATA: Dict = {
    "name": "platform-topology",
    "environment": {"mode": "docker", "docker_network": "sdn_lab_net", "ssh_key_path": "~/.ssh/id_rsa"},
    "controllers": [
        {
            "id": "ctrl-ryu",
            "type": "ryu",
            "api_base_url": "http://127.0.0.1:8080",
            "openflow": {"host": "127.0.0.1", "port": 6633},
            "auth": {"mode": "none", "token": None, "username": None, "password": None},
        }
    ],
    "default_controller": "ctrl-ryu",
    "nodes": [
        {"id": "c1", "role": "controller", "mgmt_ip": "172.20.0.10", "image": "ryu-controller", "container_name": "c1", "meta": {"ssh_user": "root", "ssh_port": 22}},
        {"id": "s1", "role": "switch", "type": "ovs", "mgmt_ip": "172.20.0.11", "image": "s1-img", "container_name": "s1", "bridge": "br-s1", "datapath_id": "0000000000000001", "meta": {}},
        {"id": "h1", "role": "host", "mgmt_ip": "172.20.0.12", "image": "host-img", "container_name": "h1", "meta": {"ssh_user": "root", "ssh_port": 22}},
        {"id": "h2", "role": "host", "mgmt_ip": "172.20.0.13", "image": "host-img", "container_name": "h2", "meta": {"ssh_user": "root", "ssh_port": 22}},
    ],
    "links": [
        {"source": "s1", "target": "h1", "bandwidth_mbps": 1000, "delay_ms": 1, "loss_pct": 0.0},
        {"source": "s1", "target": "h2", "bandwidth_mbps": 1000, "delay_ms": 1, "loss_pct": 0.0},
        {"source": "s1", "target": "c1", "bandwidth_mbps": 1000, "delay_ms": 1, "loss_pct": 0.0},
    ],
    "traffic_profiles": [
        {
            "name": "ping-baseline",
            "generator": "ping",
            "src": "h1",
            "dst": "h2",
            "protocol": "icmp",
            "duration_sec": 30,
            "params": {"count": "20", "interval": "1s"},
        }
    ],
    "metric_plan": {
        "metrics": ["latency_ms", "packet_loss_pct", "throughput_mbps"],
        "interval_sec": 5.0,
        "labels": ["experiment_id", "run_id", "topology_id", "src", "dst"],
    },
    "flow_templates": [
        {"name": "h1_to_h2", "controller": "ctrl-ryu", "match": {"in_port": "1", "eth_type": "0x0800"}, "actions": {"output": "2"}, "priority": 100},
        {"name": "h2_to_h1", "controller": "ctrl-ryu", "match": {"in_port": "2", "eth_type": "0x0800"}, "actions": {"output": "1"}, "priority": 100},
    ],
}


def _load_app(monkeypatch, tmp_path):
    cfg_path = tmp_path / "platform_config.json"
    cfg_path.write_text(json.dumps(CONFIG_DATA), encoding="utf-8")
    monkeypatch.setenv("PLATFORM_CONFIG_PATH", str(cfg_path))
    import sys

    # Clear cached modules to force re-bootstrap with the new config path
    sys.modules.pop("platform.backend.api.app", None)
    sys.modules.pop("platform.backend.api", None)

    app_module = importlib.import_module("platform.backend.api.app")
    return app_module


def test_health_and_bootstrap(monkeypatch, tmp_path):
    app_module = _load_app(monkeypatch, tmp_path)
    client = TestClient(app_module.app)

    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    assert "platform-topology" in app_module.topologies
    assert len(app_module.flows) == 2
    metric_names = {m.name for m in app_module.metric_definitions}
    assert {"latency_ms", "packet_loss_pct"}.issubset(metric_names)


def test_topology_and_experiment_lifecycle(monkeypatch, tmp_path):
    app_module = _load_app(monkeypatch, tmp_path)
    client = TestClient(app_module.app)

    # Create a new topology
    topo_payload = {
        "name": "t1",
        "controller": "ctrl-ryu",
        "nodes": [
            {"id": "ctrl1", "type": "controller", "mgmt_ip": "10.0.0.1", "image": "ctrl-img"},
            {"id": "sw1", "type": "switch", "mgmt_ip": "10.0.0.2", "image": "ovs"},
            {"id": "h1", "type": "host", "mgmt_ip": "10.0.0.3", "image": "host"},
        ],
        "links": [
            {"source": "sw1", "target": "h1", "bandwidth_mbps": 100, "delay_ms": 1, "loss_pct": 0.0},
            {"source": "sw1", "target": "ctrl1", "bandwidth_mbps": 100, "delay_ms": 1, "loss_pct": 0.0},
        ],
    }
    topo_resp = client.post("/topologies", json=topo_payload)
    assert topo_resp.status_code == 201
    topo_id = topo_resp.json()["id"]

    # Create experiment on that topology
    exp_payload = {
        "topology_id": topo_id,
        "name": "exp1",
        "description": "test experiment",
        "traffic": [
            {"generator": "ping", "src": "h1", "dst": "h1", "protocol": "icmp", "duration_sec": 5, "params": {}},
        ],
        "metrics": {
            "metrics": ["latency_ms"],
            "interval_sec": 2.0,
            "labels": ["experiment_id", "run_id", "topology_id"],
        },
        "duration_sec": 5,
        "tags": [],
    }
    exp_resp = client.post("/experiments", json=exp_payload)
    assert exp_resp.status_code == 201
    exp_id = exp_resp.json()["id"]

    # Start a run
    run_resp = client.post(f"/experiments/{exp_id}/run")
    assert run_resp.status_code == 201
    run_id = run_resp.json()["id"]

    # Fetch run
    get_run = client.get(f"/runs/{run_id}")
    assert get_run.status_code == 200
    assert get_run.json()["id"] == run_id

    # Metrics definitions endpoint
    defs_resp = client.get("/metrics/definitions")
    assert defs_resp.status_code == 200
    assert len(defs_resp.json()) >= 1

    # Create and delete a flow on the new topology (204)
    flow_payload = {
        "topology_id": topo_id,
        "controller": "ctrl-ryu",
        "match": {"in_port": "1"},
        "actions": {"output": "2"},
        "priority": 100,
    }
    flow_resp = client.post("/flows", json=flow_payload)
    assert flow_resp.status_code == 201
    flow_id = flow_resp.json()["id"]

    del_flow = client.delete(f"/flows/{flow_id}")
    assert del_flow.status_code == 204
    del_exp = client.delete(f"/experiments/{exp_id}")
    assert del_exp.status_code == 204
    del_topo = client.delete(f"/topologies/{topo_id}")
    assert del_topo.status_code == 204

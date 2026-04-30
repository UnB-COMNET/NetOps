from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import time
import re
import subprocess
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Sequence
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from platform.backend.core.metrics import ensure_labels
from platform.backend.config_loader import (
    flows_from_config,
    load_platform_config,
    metric_definitions_from_config,
    metric_layer_flags,
    topology_from_config,
    validate_config,
)
from platform.backend.schemas import (
    Experiment,
    ExperimentCreate,
    ExperimentRun,
    ExperimentUpdate,
    FlowRule,
    MetricDefinition,
    MetricLayer,
    MetricQuery,
    MetricRecord,
    MetricSample,
    Topology,
    TopologyCreate,
    TopologyUpdate,
)

from platform.backend.core.metric_catalog import metric_definitions as catalog_metric_definitions
from platform.backend.core.netmon_blocks import list_grc_blocks
from platform.backend.core.netmon_bridge import netmon_metric_definitions, run_host_ping, samples_from_netmon

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="NetOps Studio API",
    version="0.1.0",
    docs_url="/docs" if os.getenv("ENV", "dev") == "dev" else None,
    redoc_url="/redoc" if os.getenv("ENV", "dev") == "dev" else None,
)

api_key = os.getenv("API_KEY")
if not api_key and os.getenv("ENV") == "production":
    logger.warning("API_KEY não configurada em produção!")

allowed_origins = os.getenv(
    "CORS_ALLOW_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:5173,http://localhost:5174,"
    "http://127.0.0.1:5173,http://127.0.0.1:5174,"
    "http://0.0.0.0:5173,http://0.0.0.0:5174",
).split(",")
config_path = os.getenv("PLATFORM_CONFIG_PATH", "platform/experiments/platform_config.json")
raw_dir = Path("raw")
raw_dir.mkdir(parents=True, exist_ok=True)

temp_root = Path(os.getenv("PLATFORM_TEMP_DIR", "temp"))
temp_store_dir = temp_root / "experiments"
temp_experiments_dir = temp_store_dir / "registry"
legacy_temp_experiments_dir = temp_store_dir / "experiments"
temp_runs_dir = temp_store_dir / "runs"
temp_run_metrics_dir = temp_store_dir / "run_metrics"
for _d in [temp_experiments_dir, legacy_temp_experiments_dir, temp_runs_dir, temp_run_metrics_dir]:
    _d.mkdir(parents=True, exist_ok=True)

# ── Persistent experiments store ──────────────────────────────────────────────
# Defaults to  <project_root>/experiments/  but can be overridden via env var.
# This directory is meant to survive across restarts and is safe to back up or
# share.  Sub-folders mirror the temp layout for easy migration.
_experiments_root = Path(os.getenv("EXPERIMENTS_DIR", "experiments"))
experiments_registry_dir = _experiments_root / "registry"
experiments_runs_dir = _experiments_root / "runs"
experiments_run_metrics_dir = _experiments_root / "run_metrics"
for _d in [experiments_registry_dir, experiments_runs_dir, experiments_run_metrics_dir]:
    _d.mkdir(parents=True, exist_ok=True)

temp_configs_dir = temp_root / "configs"
temp_configs_dir.mkdir(parents=True, exist_ok=True)
active_config_path = temp_configs_dir / "active.json"
software_version = (
    os.getenv("SOFTWARE_VERSION")
    or Path("VERSION").read_text(encoding="utf-8").strip()
    if Path("VERSION").exists()
    else "dev"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-API-Key"],
    max_age=600,
)

# Rate limiting: simple in-memory tracker (use Redis em produção)
_rate_limit_store: Dict[str, List[float]] = defaultdict(list)
RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "100"))
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))

@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    now = time.time()
    
    # Limpar timestamps antigos
    _rate_limit_store[client_ip] = [
        ts for ts in _rate_limit_store[client_ip]
        if now - ts < RATE_LIMIT_WINDOW
    ]
    
    if len(_rate_limit_store[client_ip]) >= RATE_LIMIT_REQUESTS:
        logger.warning(f"Rate limit exceeded for {client_ip}")
        return Response(
            content=json.dumps({"detail": "Too many requests"}),
            status_code=429,
            media_type="application/json"
        )
    
    _rate_limit_store[client_ip].append(now)
    return await call_next(request)


def _generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def _raw_file_for_layer(layer: MetricLayer) -> Path:
    return raw_dir / f"metrics_{layer}.jsonl"


def _serialize_sample(sample: MetricSample) -> str:
    return json.dumps(
        {
            "timestamp": sample.timestamp.isoformat(),
            "node": sample.node,
            "layer": sample.layer,
            "metric": sample.metric,
            "value": sample.value,
            "details": sample.details,
            "labels": sample.labels,
        }
    )


def _write_samples_to_raw(samples: Sequence[MetricSample]) -> None:
    for sample in samples:
        path = _raw_file_for_layer(sample.layer)
        with path.open("a", encoding="utf-8") as f:
            f.write(_serialize_sample(sample) + "\n")


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)


def _persist_experiment(experiment: Experiment) -> None:
    data = json.dumps(experiment.model_dump(mode="json"), indent=2, ensure_ascii=False)
    # Write to both temp (backward compat) and persistent store.
    _atomic_write_text(temp_experiments_dir / f"{experiment.id}.json", data)
    _atomic_write_text(experiments_registry_dir / f"{experiment.id}.json", data)


def _persist_run(run: ExperimentRun) -> None:
    data = json.dumps(run.model_dump(mode="json"), indent=2, ensure_ascii=False)
    _atomic_write_text(temp_runs_dir / f"{run.id}.json", data)
    _atomic_write_text(experiments_runs_dir / f"{run.id}.json", data)


def _persist_run_metrics(run_id: str) -> None:
    metrics = run_metrics.get(run_id, [])
    data = json.dumps([m.model_dump(mode="json") for m in metrics], indent=2, ensure_ascii=False)
    _atomic_write_text(temp_run_metrics_dir / f"{run_id}.json", data)
    _atomic_write_text(experiments_run_metrics_dir / f"{run_id}.json", data)


def _delete_persisted_experiment(experiment_id: str) -> None:
    for d in [temp_experiments_dir, legacy_temp_experiments_dir, experiments_registry_dir]:
        (d / f"{experiment_id}.json").unlink(missing_ok=True)


def _delete_persisted_run(run_id: str) -> None:
    for d in [temp_runs_dir, experiments_runs_dir]:
        (d / f"{run_id}.json").unlink(missing_ok=True)
    for d in [temp_run_metrics_dir, experiments_run_metrics_dir]:
        (d / f"{run_id}.json").unlink(missing_ok=True)


def _load_experiments_and_runs_from_temp() -> None:
    # Best-effort restore for researcher workflow; ignore corrupt files.
    # Persistent store (experiments/) takes priority over temp.
    for root in [legacy_temp_experiments_dir, temp_experiments_dir, experiments_registry_dir]:
        for path in sorted(root.glob("*.json")):
            try:
                obj = json.loads(path.read_text(encoding="utf-8"))
                exp = Experiment(**obj)
                experiments[exp.id] = exp
            except Exception:
                continue

    for root in [temp_runs_dir, experiments_runs_dir]:
        for path in sorted(root.glob("*.json")):
            try:
                obj = json.loads(path.read_text(encoding="utf-8"))
                run = ExperimentRun(**obj)
                runs[run.id] = run
                run_metrics.setdefault(run.id, [])
            except Exception:
                continue

    for root in [temp_run_metrics_dir, experiments_run_metrics_dir]:
        for path in sorted(root.glob("*.json")):
            try:
                run_id = path.stem
                items = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(items, list):
                    continue
                run_metrics[run_id] = [MetricRecord(**item) for item in items if isinstance(item, dict)]
            except Exception:
                continue


def _load_active_config_id() -> str | None:
    try:
        if not active_config_path.exists():
            return None
        obj = json.loads(active_config_path.read_text(encoding="utf-8"))
        config_id = obj.get("active") if isinstance(obj, dict) else None
        return str(config_id) if config_id else None
    except Exception:
        return None


def _set_active_config_id(config_id: str) -> None:
    _atomic_write_text(active_config_path, json.dumps({"active": config_id}, indent=2, ensure_ascii=False))


def _config_path_for_id(config_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", config_id.strip()).strip("_")
    return temp_configs_dir / f"{safe}.json"


def _list_configs() -> List[Dict[str, Any]]:
    active_id = _load_active_config_id()
    items: List[Dict[str, Any]] = []
    for path in sorted(temp_configs_dir.glob("*.json")):
        if path.name == "active.json":
            continue
        config_id = path.stem
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
            name = obj.get("name") if isinstance(obj, dict) else None
            updated_at = obj.get("updated_at") if isinstance(obj, dict) else None
        except Exception:
            name = None
            updated_at = None
        items.append({"id": config_id, "name": name or config_id, "active": config_id == active_id, "updated_at": updated_at})
    return items


def _read_config_payload(config_id: str) -> Dict[str, Any]:
    path = _config_path_for_id(config_id)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Config not found")
    try:
        obj = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(obj, dict):
            raise ValueError("config must be an object")
        return obj
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid config JSON")


def _write_config_payload(config_id: str, payload: Dict[str, Any]) -> None:
    # Validate the embedded platform config if present.
    cfg = payload.get("config") if isinstance(payload.get("config"), dict) else None
    if cfg is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing 'config' object")
    validate_config(cfg)
    payload = {
        **payload,
        "id": config_id,
        "updated_at": datetime.utcnow().isoformat(),
    }
    _atomic_write_text(_config_path_for_id(config_id), json.dumps(payload, indent=2, ensure_ascii=False))


def _seed_default_config_if_missing() -> None:
    # Ensure at least one saved config exists: keep current repo default as lft-netops.
    if any(p for p in temp_configs_dir.glob("*.json") if p.name != "active.json"):
        return
    try:
        default_cfg = load_platform_config(config_path)
        payload = {
            "name": "lft-netops",
            "description": "Configuração padrão (docker) do NetOps Studio (Network Operations)",
            "environment": "docker",
            "config": default_cfg,
        }
        _write_config_payload("lft-netops", payload)
        _set_active_config_id("lft-netops")
    except Exception:
        # Best-effort only.
        pass


def _apply_active_config() -> None:
    """Apply the active saved config to in-memory runtime state."""
    global metric_definitions, layer_flags
    active_id = _load_active_config_id()
    if not active_id:
        return
    obj = _read_config_payload(active_id)
    cfg = obj.get("config") if isinstance(obj.get("config"), dict) else None
    if not cfg:
        return
    topology = topology_from_config(cfg)
    if topology and topology.id not in topologies:
        topologies[topology.id] = topology

    cfg_metrics = metric_definitions_from_config(cfg)
    if cfg_metrics:
        merged: Dict[str, MetricDefinition] = {m.name: m for m in _extended_metric_definitions()}
        merged.update({m.name: m for m in cfg_metrics})
        metric_definitions = list(merged.values())
    else:
        metric_definitions = _extended_metric_definitions()

    layer_flags = metric_layer_flags(cfg)


def _load_recent_samples_from_raw(limit: int = 200) -> List[MetricSample]:
    loaded: List[MetricSample] = []

    def _tail(path: Path, max_lines: int) -> List[str]:
        if not path.exists():
            return []
        with path.open("r", encoding="utf-8") as f:
            lines = f.readlines()
        return lines[-max_lines:]

    for layer in [
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
    ]:
        for line in _tail(_raw_file_for_layer(layer), limit):
            try:
                obj = json.loads(line)
                loaded.append(
                    MetricSample(
                        timestamp=datetime.fromisoformat(obj.get("timestamp")),
                        node=obj.get("node", ""),
                        layer=obj.get("layer", layer),
                        metric=obj.get("metric", ""),
                        value=float(obj.get("value", 0)),
                        details=obj.get("details") or {},
                        labels=_normalize_labels(obj.get("labels") or {}),
                    )
                )
            except Exception:
                continue
    return loaded


def _normalize_labels(labels: Dict[str, Any] | None) -> Dict[str, Any]:
    normalized = ensure_labels(labels or {})
    normalized.setdefault("version", software_version)
    return normalized


def _normalize_sample(sample: MetricSample) -> MetricSample:
    return MetricSample(
        timestamp=sample.timestamp,
        node=sample.node,
        layer=sample.layer,
        metric=sample.metric,
        value=sample.value,
        details=sample.details,
        labels=_normalize_labels(sample.labels),
    )


def _append_run_log(run_id: str, message: str) -> None:
    run = runs.get(run_id)
    if not run:
        return
    entry = f"{datetime.utcnow().isoformat()} {message}"
    run.logs.append(entry)


def _store_samples(samples: Sequence[MetricSample]) -> None:
    normalized = [_normalize_sample(sample) for sample in samples]
    metric_samples.extend(normalized)
    _write_samples_to_raw(normalized)
    for sample in normalized:
        try:
            seen_metric_names.add(str(sample.metric))
        except Exception:
            pass
    touched_run_ids: set[str] = set()
    for sample in normalized:
        run_id = sample.labels.get("run_id") if sample.labels else None
        if run_id:
            touched_run_ids.add(str(run_id))
            record = MetricRecord(
                timestamp=sample.timestamp,
                metric_name=sample.metric,
                value=sample.value,
                layer=sample.layer,
                labels=sample.labels,
                details=sample.details,
            )
            run_metrics.setdefault(run_id, []).append(record)
            _append_run_log(run_id, f"metric:{sample.metric}")

    for run_id in touched_run_ids:
        try:
            _persist_run_metrics(run_id)
        except Exception:
            pass


def _run_cmd(cmd: List[str], timeout: int = 6) -> str:
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=True)
        return res.stdout
    except (subprocess.SubprocessError, OSError):
        return ""


def _parse_ss_summary(output: str) -> Dict[str, float]:
    summary: Dict[str, float] = {
        "total": 0,
        "tcp_total": 0,
        "tcp_estab": 0,
        "tcp_closed": 0,
        "tcp_orphaned": 0,
        "tcp_timewait": 0,
    }
    matrix: Dict[str, Dict[str, float]] = {proto: {"total": 0, "ip": 0, "ipv6": 0} for proto in ["udp", "tcp", "raw", "inet", "frag"]}
    for line in output.splitlines():
        if line.startswith("Total:"):
            m = re.search(r"Total:\s+(\d+)", line)
            if m:
                summary["total"] = float(m.group(1))
        if line.startswith("TCP:"):
            m = re.search(r"TCP:\s+(\d+).*estab\s+(\d+), closed\s+(\d+), orphaned\s+(\d+), timewait\s+(\d+)", line)
            if m:
                summary.update(
                    {
                        "tcp_total": float(m.group(1)),
                        "tcp_estab": float(m.group(2)),
                        "tcp_closed": float(m.group(3)),
                        "tcp_orphaned": float(m.group(4)),
                        "tcp_timewait": float(m.group(5)),
                    }
                )
        if any(line.startswith(prefix) for prefix in ["UDP", "TCP", "RAW", "INET", "FRAG"]):
            parts = line.split()
            if len(parts) >= 4:
                proto = parts[0].lower()
                try:
                    total, ip_v4, ip_v6 = float(parts[1]), float(parts[2]), float(parts[3])
                    matrix.setdefault(proto, {"total": 0, "ip": 0, "ipv6": 0})
                    matrix[proto].update({"total": total, "ip": ip_v4, "ipv6": ip_v6})
                except ValueError:
                    continue
    return {**summary, **{f"{proto}_{k}": v for proto, vals in matrix.items() for k, v in vals.items()}}


def _parse_snmp(output: str) -> Dict[str, float]:
    lines = [ln for ln in output.splitlines() if ":" in ln]
    results: Dict[str, float] = {}
    i = 0
    while i < len(lines) - 1:
        header = lines[i].split()
        values = lines[i + 1].split()
        if header[0].rstrip(":") == values[0].rstrip(":"):
            prefix = header[0].rstrip(":").lower()
            keys = header[1:]
            vals = values[1:]
            for k, v in zip(keys, vals):
                try:
                    results[f"{prefix}_{k.lower()}"] = float(v)
                except ValueError:
                    continue
        i += 2
    return results


def _parse_ip_link(output: str) -> Dict[str, Dict[str, float]]:
    # Returns iface -> metrics
    metrics: Dict[str, Dict[str, float]] = {}
    current = None
    for line in output.splitlines():
        if re.match(r"^\d+: ", line):
            current = line.split(":", 1)[1].strip().split()[0]
            metrics.setdefault(current, {})
        if current and "RX:" in line:
            continue
        if current and "TX:" in line:
            continue
        if current and "errors" in line and "dropped" in line:
            parts = line.split()
            try:
                errors = float(parts[1])
                dropped = float(parts[3])
                metrics[current].setdefault("errors", 0.0)
                metrics[current].setdefault("dropped", 0.0)
                metrics[current]["errors"] += errors
                metrics[current]["dropped"] += dropped
            except (IndexError, ValueError):
                continue
    return metrics


def _collect_real(topology: Topology | None, labels: Dict[str, Any] | None = None) -> List[MetricSample]:
    if not topology:
        return []
    now = datetime.utcnow()
    base_labels = _normalize_labels(labels)
    samples: List[MetricSample] = []

    def _mk(metric: str, layer: MetricLayer, node: str, value: float, details: Dict | None = None, labels: Dict | None = None) -> MetricSample:
        return MetricSample(
            timestamp=now,
            node=node,
            layer=layer,
            metric=metric,
            value=value,
            details=details or {},
            labels=_normalize_labels(labels or base_labels),
        )

    for node in topology.nodes:
        container = node.meta.get("container_name") or node.id
        # Transport: ss -s and /proc/net/snmp
        if layer_flags.get("transport", True):
            ss_output = _run_cmd(["docker", "exec", container, "ss", "-s"]) if container else ""
            ss_data = _parse_ss_summary(ss_output) if ss_output else {}
            if ss_data:
                samples.append(_mk("ss_sockets_total", "transport", node.id, ss_data.get("total", 0.0), {"source": "ss -s"}))
                samples.append(
                    _mk(
                        "ss_tcp_states",
                        "transport",
                        node.id,
                        ss_data.get("tcp_total", 0.0),
                        {
                            "estab": ss_data.get("tcp_estab", 0.0),
                            "closed": ss_data.get("tcp_closed", 0.0),
                            "orphaned": ss_data.get("tcp_orphaned", 0.0),
                            "timewait": ss_data.get("tcp_timewait", 0.0),
                            "source": "ss -s",
                        },
                    )
                )
                for proto in ["udp", "tcp", "raw", "inet", "frag"]:
                    samples.append(
                        _mk(
                            f"ss_{proto}_sockets_total",
                            "transport",
                            node.id,
                            ss_data.get(f"{proto}_total", 0.0),
                            {
                                "ip": ss_data.get(f"{proto}_ip", 0.0),
                                "ipv6": ss_data.get(f"{proto}_ipv6", 0.0),
                                "source": "ss -s",
                            },
                        )
                    )

            snmp_output = _run_cmd(["docker", "exec", container, "cat", "/proc/net/snmp"]) if container else ""
            snmp_data = _parse_snmp(snmp_output) if snmp_output else {}
            for key, val in snmp_data.items():
                samples.append(_mk(f"snmp_{key}", "transport", node.id, float(val), {"source": "/proc/net/snmp"}))

        # Link/Physical: ip -s link
        if layer_flags.get("link", True) or layer_flags.get("physical", True):
            ip_link_output = _run_cmd(["docker", "exec", container, "ip", "-s", "link"]) if container else ""
            ip_link_stats = _parse_ip_link(ip_link_output) if ip_link_output else {}
            for iface, vals in ip_link_stats.items():
                path = f"{node.id}:{iface}"
                if layer_flags.get("physical", True):
                    samples.append(_mk("if_errors", "physical", path, vals.get("errors", 0.0), {"source": "ip -s link"}))
                    samples.append(_mk("if_discards", "physical", path, vals.get("dropped", 0.0), {"source": "ip -s link"}))
                if layer_flags.get("link", True):
                    samples.append(_mk("queue_drops", "link", path, vals.get("dropped", 0.0), {"source": "ip -s link"}))

        # Network: basic ping between hosts (h1->h2, h2->h1 when mgmt_ip available)
        if layer_flags.get("network", True) and node.type == "host":
            peers = [n for n in topology.nodes if n.type == "host" and n.id != node.id and n.mgmt_ip]
            if peers:
                target = peers[0]
                ping_cmd = ["docker", "exec", container, "ping", "-c", "3", "-i", "0.2", target.mgmt_ip]
                ping_output = _run_cmd(ping_cmd)
                m = re.search(r"(\d+)% packet loss", ping_output)
                loss = float(m.group(1)) if m else 0.0
                rtt_match = re.search(r"rtt min/avg/max/mdev = ([0-9.]+)/([0-9.]+)/([0-9.]+)/([0-9.]+)", ping_output)
                if rtt_match:
                    latency = float(rtt_match.group(2))
                    jitter = float(rtt_match.group(4))
                else:
                    latency = 0.0
                    jitter = 0.0
                samples.append(_mk("latency_ms", "network", node.id, latency, {"dst": target.id, "source": "ping"}))
                samples.append(_mk("packet_loss_pct", "network", node.id, loss, {"dst": target.id, "source": "ping"}))
                samples.append(_mk("jitter_ms", "network", node.id, jitter, {"dst": target.id, "source": "ping"}))

        # Control/Dataplane (best-effort with ovs-ofctl on switches)
        if node.type == "switch" and layer_flags.get("control", True):
            ofctl_ports = _run_cmd(["docker", "exec", container, "ovs-ofctl", "dump-ports", "br-s1"]) if container else ""
            if ofctl_ports:
                samples.append(_mk("controller_conn_ok", "control", node.id, 1.0, {"source": "ovs-ofctl"}))
        if node.type == "switch" and layer_flags.get("dataplane", True):
            flows_dump = _run_cmd(["docker", "exec", container, "ovs-ofctl", "dump-flows", "br-s1"]) if container else ""
            if flows_dump:
                lines = [ln for ln in flows_dump.splitlines() if "n_packets" in ln]
                for idx, ln in enumerate(lines[:10]):
                    m_pkts = re.search(r"n_packets=(\d+)", ln)
                    m_bytes = re.search(r"n_bytes=(\d+)", ln)
                    pkts = float(m_pkts.group(1)) if m_pkts else 0.0
                    byt = float(m_bytes.group(1)) if m_bytes else 0.0
                    samples.append(_mk("openflow_flow_packets", "dataplane", node.id, pkts, {"flow_id": f"flow_{idx}", "source": "ovs-ofctl"}))
                    samples.append(_mk("openflow_flow_bytes", "dataplane", node.id, byt, {"flow_id": f"flow_{idx}", "source": "ovs-ofctl"}))
    return samples


def _collect_synthetic_full(topology: Topology | None, labels: Dict[str, Any] | None = None) -> List[MetricSample]:
    if not topology:
        return []
    now = datetime.utcnow()
    base_labels = _normalize_labels(labels)
    samples: List[MetricSample] = []

    def _mk(metric: str, layer: MetricLayer, node: str, value: float, details: Dict | None = None, labels: Dict | None = None) -> MetricSample:
        return MetricSample(
            timestamp=now,
            node=node,
            layer=layer,
            metric=metric,
            value=value,
            details=details or {},
            labels=_normalize_labels(labels or base_labels),
        )

    if layer_flags.get("physical", True):
        for link in topology.links:
            path = f"{link.source}->{link.target}"
            samples.append(_mk("if_errors", "physical", path, float(random.randint(0, 3))))
            samples.append(_mk("if_discards", "physical", path, float(random.randint(0, 3))))
            samples.append(_mk("if_crc_errors", "physical", path, float(random.randint(0, 2))))
            samples.append(_mk("if_in_util_pct", "physical", path, round(random.uniform(10, 80), 3)))
            samples.append(_mk("if_out_util_pct", "physical", path, round(random.uniform(10, 80), 3)))
            samples.append(_mk("if_temp_c", "physical", path, round(random.uniform(35, 65), 2)))
            samples.append(_mk("if_optic_rx_dbm", "physical", path, round(random.uniform(-6.0, -1.0), 2)))
            samples.append(_mk("if_optic_tx_dbm", "physical", path, round(random.uniform(-2.0, 2.0), 2)))

    if layer_flags.get("link", True):
        for link in topology.links:
            path = f"{link.source}->{link.target}"
            util = random.uniform(5, 90)
            jitter = random.uniform(0, 5)
            loss = random.uniform(0, 2)
            samples.append(_mk("link_util_pct", "link", path, round(util, 2), {"direction": "bidirectional"}))
            samples.append(_mk("link_loss_pct", "link", path, round(loss, 3)))
            samples.append(_mk("link_jitter_ms", "link", path, round(jitter, 3)))
            samples.append(_mk("queue_occupancy_pct", "link", link.source, round(random.uniform(0, 70), 2)))
            samples.append(_mk("queue_drops", "link", link.source, float(random.randint(0, 20))))
            samples.append(_mk("ecn_marked_pct", "link", path, round(random.uniform(0, 1), 3)))

    if layer_flags.get("network", True):
        for node in topology.nodes:
            if node.type in {"host", "switch"}:
                rtt = random.uniform(0.2, 8.0)
                loss = random.uniform(0, 3.0)
                jitter = random.uniform(0, 2.0)
                samples.append(_mk("latency_ms", "network", node.id, round(rtt, 3)))
                samples.append(_mk("packet_loss_pct", "network", node.id, round(loss, 3)))
                samples.append(_mk("jitter_ms", "network", node.id, round(jitter, 3)))
                samples.append(_mk("ttl_expired", "network", node.id, float(random.randint(0, 2))))
                samples.append(_mk("routes_count", "network", node.id, float(random.randint(1, 32))))
                samples.append(_mk("arp_entries", "network", node.id, float(random.randint(1, 64))))

    if layer_flags.get("service", True):
        hosts = [n for n in topology.nodes if n.type == "host"]
        if len(hosts) >= 2:
            src = hosts[0].id
            dst = hosts[1].id
            service = "ping"
            svc_labels = {**base_labels, "src": src, "dst": dst, "service": service}
            samples.append(_mk("e2e_path_availability_pct", "service", "probe", round(random.uniform(98.5, 100.0), 3), labels=svc_labels))
            samples.append(_mk("e2e_latency_ms_p50", "service", "probe", round(random.uniform(3.0, 30.0), 3), labels=svc_labels))
            samples.append(_mk("e2e_latency_ms_p95", "service", "probe", round(random.uniform(6.0, 60.0), 3), labels=svc_labels))
            samples.append(_mk("e2e_latency_ms_p99", "service", "probe", round(random.uniform(8.0, 90.0), 3), labels=svc_labels))
            samples.append(_mk("e2e_jitter_ms_p95", "service", "probe", round(random.uniform(0.1, 8.0), 3), labels=svc_labels))
            samples.append(_mk("e2e_loss_pct", "service", "probe", round(random.uniform(0.0, 2.0), 3), labels=svc_labels))

    if layer_flags.get("transport", True):
        for node in topology.nodes:
            if node.type == "host":
                samples.append(_mk("throughput_mbps", "transport", node.id, round(random.uniform(50, 900), 2)))
                samples.append(_mk("tcp_retrans_pct", "transport", node.id, round(random.uniform(0, 5), 3)))
                samples.append(_mk("tcp_rtt_ms", "transport", node.id, round(random.uniform(1, 30), 3)))
                samples.append(_mk("udp_jitter_ms", "transport", node.id, round(random.uniform(0, 5), 3)))
                samples.append(_mk("udp_loss_pct", "transport", node.id, round(random.uniform(0, 5), 3)))

                # ss -s synthetic snapshot
                ss_totals = {
                    "total": random.randint(2, 12),
                    "tcp_total": random.randint(1, 12),
                    "tcp_estab": random.randint(0, 4),
                    "tcp_closed": random.randint(8, 16),
                    "tcp_orphaned": random.randint(0, 1),
                    "tcp_timewait": random.randint(0, 4),
                }
                udp_ip = random.randint(0, 3)
                udp_ipv6 = random.randint(0, 3)
                tcp_ip = random.randint(0, 3)
                tcp_ipv6 = random.randint(0, 3)
                raw_ip = random.randint(0, 1)
                raw_ipv6 = random.randint(0, 1)
                ss_transport_matrix = {
                    "udp": {"total": udp_ip + udp_ipv6, "ip": udp_ip, "ipv6": udp_ipv6},
                    "tcp": {"total": tcp_ip + tcp_ipv6, "ip": tcp_ip, "ipv6": tcp_ipv6},
                    "raw": {"total": raw_ip + raw_ipv6, "ip": raw_ip, "ipv6": raw_ipv6},
                    "inet": {"total": (udp_ip + udp_ipv6 + tcp_ip + tcp_ipv6), "ip": udp_ip + tcp_ip, "ipv6": udp_ipv6 + tcp_ipv6},
                    "frag": {"total": random.randint(0, 1), "ip": random.randint(0, 1), "ipv6": 0},
                }

                samples.append(_mk("ss_sockets_total", "transport", node.id, float(ss_totals["total"]), {"source": "ss -s"}))
                samples.append(
                    _mk(
                        "ss_tcp_states",
                        "transport",
                        node.id,
                        float(ss_totals["tcp_total"]),
                        {
                            "estab": ss_totals["tcp_estab"],
                            "closed": ss_totals["tcp_closed"],
                            "orphaned": ss_totals["tcp_orphaned"],
                            "timewait": ss_totals["tcp_timewait"],
                            "source": "ss -s",
                        },
                    )
                )
                for proto, counts in ss_transport_matrix.items():
                    samples.append(
                        _mk(
                            f"ss_{proto}_sockets_total",
                            "transport",
                            node.id,
                            float(counts["total"]),
                            {"ip": counts["ip"], "ipv6": counts["ipv6"], "source": "ss -s"},
                        )
                    )

                # /proc/net/snmp synthetic snapshot
                ip_snmp = {
                    "in_receives": random.randint(10, 200),
                    "in_hdr_errors": random.randint(0, 2),
                    "in_addr_errors": random.randint(0, 2),
                    "forw_datagrams": random.randint(0, 3),
                    "in_unknown_protos": random.randint(0, 1),
                    "in_discards": random.randint(0, 2),
                    "in_delivers": random.randint(5, 25),
                    "out_requests": random.randint(5, 25),
                    "out_discards": random.randint(0, 2),
                    "out_no_routes": random.randint(0, 1),
                    "reasm_timeout": 0,
                    "reasm_reqds": random.randint(0, 1),
                    "reasm_oks": random.randint(0, 1),
                    "reasm_fails": random.randint(0, 1),
                    "frag_oks": random.randint(0, 1),
                    "frag_fails": random.randint(0, 1),
                    "frag_creates": random.randint(0, 1),
                    "out_transmits": random.randint(5, 25),
                }
                icmp_snmp = {
                    "in_msgs": random.randint(0, 10),
                    "out_msgs": random.randint(0, 10),
                    "in_errors": random.randint(0, 1),
                    "out_errors": random.randint(0, 1),
                    "in_dest_unreachs": random.randint(0, 1),
                    "out_dest_unreachs": random.randint(0, 1),
                    "in_time_excds": random.randint(0, 1),
                    "out_time_excds": random.randint(0, 1),
                    "in_echo_reqs": random.randint(0, 5),
                    "out_echo_reps": random.randint(0, 5),
                }
                tcp_snmp = {
                    "active_opens": random.randint(0, 3),
                    "passive_opens": random.randint(0, 3),
                    "attempt_fails": random.randint(0, 1),
                    "estab_resets": random.randint(0, 1),
                    "curr_estab": random.randint(0, 2),
                    "in_segs": random.randint(0, 30),
                    "out_segs": random.randint(0, 30),
                    "retrans_segs": random.randint(0, 5),
                    "in_errs": random.randint(0, 1),
                    "out_rsts": random.randint(0, 1),
                    "in_csum_errors": random.randint(0, 1),
                }
                udp_snmp = {
                    "in_datagrams": random.randint(0, 10),
                    "no_ports": random.randint(0, 2),
                    "in_errors": random.randint(0, 1),
                    "out_datagrams": random.randint(0, 10),
                    "rcvbuf_errors": random.randint(0, 1),
                    "sndbuf_errors": random.randint(0, 1),
                    "in_csum_errors": random.randint(0, 1),
                    "ignored_multi": random.randint(0, 1),
                    "mem_errors": random.randint(0, 1),
                }

                for key, val in ip_snmp.items():
                    samples.append(_mk(f"snmp_ip_{key}", "transport", node.id, float(val), {"source": "/proc/net/snmp"}))
                for key, val in icmp_snmp.items():
                    samples.append(_mk(f"snmp_icmp_{key}", "transport", node.id, float(val), {"source": "/proc/net/snmp"}))
                for key, val in tcp_snmp.items():
                    samples.append(_mk(f"snmp_tcp_{key}", "transport", node.id, float(val), {"source": "/proc/net/snmp"}))
                for key, val in udp_snmp.items():
                    samples.append(_mk(f"snmp_udp_{key}", "transport", node.id, float(val), {"source": "/proc/net/snmp"}))

    if layer_flags.get("session", True):
        sess_labels = {**base_labels, "sni": "example.local", "service": "web"}
        samples.append(_mk("tls_session_resumption_pct", "session", "edge", round(random.uniform(0, 100), 2), labels=sess_labels))
        samples.append(_mk("tls_renegotiations_total", "session", "edge", float(random.randint(0, 3)), labels=sess_labels))
        samples.append(_mk("tls_handshake_failures_total", "session", "edge", float(random.randint(0, 2)), labels={**base_labels, "sni": "example.local", "cert": "leaf"}))
        samples.append(_mk("vpn_sessions_active", "session", "gw", float(random.randint(0, 200)), labels={**base_labels, "profile": "default", "tenant": "lab"}))
        samples.append(_mk("aaa_auth_failures_total", "session", "aaa", float(random.randint(0, 5)), labels={**base_labels, "realm": "lab", "reason": "invalid_password"}))

    if layer_flags.get("presentation", True):
        pres_labels = {**base_labels, "sni": "example.local", "service": "web"}
        samples.append(_mk("tls_handshake_latency_ms_p95", "presentation", "edge", round(random.uniform(20, 200), 2), labels=pres_labels))
        samples.append(_mk("tls_handshake_latency_ms_p99", "presentation", "edge", round(random.uniform(40, 350), 2), labels=pres_labels))
        samples.append(_mk("tls_version_connections_total", "presentation", "edge", float(random.randint(10, 1000)), labels={**base_labels, "version": "TLS1.3", "sni": "example.local"}))
        samples.append(_mk("tls_cipher_connections_total", "presentation", "edge", float(random.randint(10, 1000)), labels={**base_labels, "cipher": "TLS_AES_128_GCM_SHA256", "sni": "example.local"}))
        samples.append(_mk("cert_expiry_days", "presentation", "edge", float(random.randint(1, 365)), labels={**base_labels, "cert": "leaf", "sni": "example.local"}))
        samples.append(_mk("http2_negotiation_success_pct", "presentation", "edge", round(random.uniform(80, 100), 2), labels={**base_labels, "service": "web"}))

    if layer_flags.get("application", True):
        for node in topology.nodes:
            if node.type == "host":
                samples.append(_mk("http_latency_ms", "application", node.id, round(random.uniform(20, 400), 2), {"status_code": 200}))
                samples.append(_mk("http_success_pct", "application", node.id, 99.0))
                samples.append(_mk("dns_latency_ms", "application", node.id, round(random.uniform(5, 80), 2)))
                samples.append(_mk("dns_success_pct", "application", node.id, 99.0))
                samples.append(_mk("tls_handshake_ms", "application", node.id, round(random.uniform(30, 150), 2)))
                samples.append(_mk("app_rps", "application", node.id, round(random.uniform(10, 2000), 2), labels={**base_labels, "service": "web", "route": "/api"}))
                samples.append(_mk("app_latency_ms_p95", "application", node.id, round(random.uniform(20, 600), 2), labels={**base_labels, "service": "web", "route": "/api"}))
                samples.append(_mk("app_latency_ms_p99", "application", node.id, round(random.uniform(30, 900), 2), labels={**base_labels, "service": "web", "route": "/api"}))
                samples.append(_mk("app_error_rate_pct", "application", node.id, round(random.uniform(0, 5), 3), labels={**base_labels, "service": "web", "route": "/api"}))

    if layer_flags.get("control", True):
        for node in topology.nodes:
            if node.type == "controller":
                samples.append(_mk("controller_latency_ms", "control", node.id, round(random.uniform(1, 25), 3)))
                samples.append(_mk("controller_conn_ok", "control", node.id, 1.0, {"ok": True}))
                samples.append(_mk("of_channel_reconnects", "control", node.id, float(random.randint(0, 1))))
                samples.append(_mk("flows_installed", "control", node.id, float(random.randint(10, 500))))
                samples.append(_mk("flows_removed", "control", node.id, float(random.randint(0, 100))))

    if layer_flags.get("dataplane", True):
        for flow in flows.values():
            topo = flow.topology_id
            samples.append(_mk("openflow_flow_packets", "dataplane", topo, float(random.randint(10, 10_000)), {"flow_id": flow.id or ""}))
            samples.append(_mk("openflow_flow_bytes", "dataplane", topo, float(random.randint(1_000, 5_000_000)), {"flow_id": flow.id or ""}))
        for link in topology.links:
            port_path = f"{link.source}->{link.target}"
            samples.append(_mk("table_hits", "dataplane", port_path, float(random.randint(1_000, 10_000))))
            samples.append(_mk("table_misses", "dataplane", port_path, float(random.randint(0, 500))))
            samples.append(_mk("port_rx_pkts", "dataplane", port_path, float(random.randint(1_000, 100_000))))
            samples.append(_mk("port_tx_pkts", "dataplane", port_path, float(random.randint(1_000, 100_000))))
            samples.append(_mk("port_rx_drops", "dataplane", port_path, float(random.randint(0, 500))))
            samples.append(_mk("port_tx_drops", "dataplane", port_path, float(random.randint(0, 500))))

    # Seed: guarantee at least one sample per MetricDefinition name.
    # This maximizes "Com dado" coverage for the dashboard taxonomy.
    try:
        batch_names = {s.metric for s in samples}
        missing_defs = [d for d in metric_definitions if d.name not in seen_metric_names and d.name not in batch_names]
        for d in missing_defs:
            layer_name = str(d.layer or "network")
            if not layer_flags.get(layer_name, True):
                continue

            unit = (d.unit or "").strip().lower()
            kind = (d.kind or "").strip().lower()

            if unit in {"%", "pct", "percent"} or "pct" in d.name:
                value = round(random.uniform(0, 100), 3)
            elif unit in {"ms", "millisecond", "milliseconds"} or d.name.endswith("_ms"):
                value = round(random.uniform(0.1, 500.0), 3)
            elif unit in {"s", "sec", "seconds"} or d.name.endswith("_s"):
                value = round(random.uniform(0.1, 60.0), 3)
            elif unit in {"bool", "boolean"}:
                value = float(random.randint(0, 1))
            elif unit in {"count", "count/s", "rps", "qps"} or kind == "counter":
                value = float(random.randint(0, 1000))
            elif unit in {"mbps", "gbps", "bps", "bits/s"}:
                value = round(random.uniform(1.0, 1000.0), 2)
            elif unit in {"bytes", "b", "kb", "mb", "gb"} or "bytes" in d.name:
                value = float(random.randint(0, 5_000_000))
            elif unit == "days":
                value = float(random.randint(0, 365))
            else:
                value = round(random.uniform(0, 100), 3)

            dim_labels = dict(base_labels)
            for dim in d.dimensions or []:
                if dim in dim_labels and dim_labels[dim] is not None:
                    continue
                if dim in {"src", "dst"}:
                    hosts = [n for n in topology.nodes if n.type == "host"]
                    if dim == "src" and hosts:
                        dim_labels[dim] = hosts[0].id
                    elif dim == "dst" and len(hosts) > 1:
                        dim_labels[dim] = hosts[1].id
                    else:
                        dim_labels[dim] = "unknown"
                elif dim in {"node", "switch", "host"}:
                    dim_labels[dim] = topology.nodes[0].id if topology.nodes else "unknown"
                elif dim == "service":
                    dim_labels[dim] = "web"
                elif dim == "route":
                    dim_labels[dim] = "/api"
                else:
                    dim_labels.setdefault(dim, "default")

            node_id = "probe"
            if layer_name in {"physical", "link", "dataplane"} and topology.links:
                node_id = f"{topology.links[0].source}->{topology.links[0].target}"
            elif topology.nodes:
                node_id = topology.nodes[0].id

            samples.append(_mk(d.name, layer_name, node_id, float(value), labels=dim_labels))
            seen_metric_names.add(d.name)
    except Exception:
        pass

    return samples


def _filter_samples(query: MetricQuery) -> List[MetricSample]:
    results: List[MetricSample] = []
    for sample in metric_samples:
        if query.metric_names and sample.metric not in query.metric_names:
            continue
        if query.nodes and sample.node not in query.nodes:
            continue
        if query.layers and sample.layer not in query.layers:
            continue
        if query.start_time and sample.timestamp < query.start_time:
            continue
        if query.end_time and sample.timestamp > query.end_time:
            continue
        results.append(sample)
        if len(results) >= query.limit:
            break
    return results


def _sample_to_dict(sample: MetricSample) -> Dict[str, Any]:
    return {
        "timestamp": sample.timestamp.isoformat(),
        "node": sample.node,
        "layer": sample.layer,
        "metric": sample.metric,
        "value": sample.value,
        "details": sample.details,
        "labels": sample.labels,
    }


async def _event_stream():
    while True:
        topology = next(iter(topologies.values()), None)

        latest_by_metric: Dict[str, MetricSample] = {}
        for s in metric_samples:
            cur = latest_by_metric.get(s.metric)
            if not cur or s.timestamp > cur.timestamp:
                latest_by_metric[s.metric] = s
        latest_for_defs: List[MetricSample] = []
        for d in metric_definitions:
            s = latest_by_metric.get(d.name)
            if s is not None:
                latest_for_defs.append(s)

        payload = {
            "type": "snapshot",
            "generated_at": datetime.utcnow().isoformat(),
            "topology": topology.model_dump() if topology else None,
            "metrics": [_sample_to_dict(s) for s in latest_for_defs],
            "runs": [run.model_dump() for run in runs.values()],
        }
        yield f"data: {json.dumps(jsonable_encoder(payload))}\n\n"
        await asyncio.sleep(2)


def require_api_key(x_api_key: str | None = Header(default=None)) -> None:
    if not api_key:
        return
    if x_api_key != api_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")


# In-memory stores; replace with real database integrations later.
topologies: Dict[str, Topology] = {}
experiments: Dict[str, Experiment] = {}
runs: Dict[str, ExperimentRun] = {}
flows: Dict[str, FlowRule] = {}
run_metrics: Dict[str, List[MetricRecord]] = {}
metric_samples: List[MetricSample] = []
seen_metric_names: set[str] = set()
layer_flags: Dict[MetricLayer, bool] = metric_layer_flags({})
real_collection_default = os.getenv("REAL_COLLECTION", "0") == "1"
collection_interval_seconds = float(os.getenv("AUTO_COLLECT_INTERVAL", "5"))
_auto_collect_task: asyncio.Task | None = None

# System settings (in-memory, pode migrar para banco posteriormente)
system_settings: Dict[str, Any] = {
    "use_real_data": real_collection_default,
    "auto_collect_enabled": False,
    "collect_interval_sec": collection_interval_seconds,
}


def _extended_metric_definitions() -> List[MetricDefinition]:
    return catalog_metric_definitions() + netmon_metric_definitions()


# Defaults; may be overridden/augmented by platform_config.json.
metric_definitions: List[MetricDefinition] = _extended_metric_definitions()


def _bootstrap_from_config() -> None:
    global metric_definitions, layer_flags
    try:
        cfg = load_platform_config(config_path)
    except FileNotFoundError:
        return
    except ValueError as exc:
        raise RuntimeError(f"Invalid platform config: {exc}") from exc

    topology = topology_from_config(cfg)
    if topology and topology.id not in topologies:
        topologies[topology.id] = topology

    cfg_metrics = metric_definitions_from_config(cfg)
    if cfg_metrics:
        merged: Dict[str, MetricDefinition] = {m.name: m for m in _extended_metric_definitions()}
        merged.update({m.name: m for m in cfg_metrics})
        metric_definitions = list(merged.values())
    else:
        metric_definitions = _extended_metric_definitions()
    layer_flags = metric_layer_flags(cfg)

    raw_dir.mkdir(parents=True, exist_ok=True)
    for layer in layer_flags:
        _raw_file_for_layer(layer).touch(exist_ok=True)

    if topology:
        controller_ids = {c.get("id") for c in cfg.get("controllers", []) if c.get("id")}
        for flow in flows_from_config(cfg, topology.id, controller_ids):
            flow_id = flow.id or _generate_id("flow")
            flows[flow_id] = FlowRule(**flow.model_dump(exclude={"id"}), id=flow_id)


_bootstrap_from_config()

# Configs (multi-environment) support.
_seed_default_config_if_missing()
try:
    _apply_active_config()
except Exception:
    pass

# Restore researcher artifacts (experiments/runs) from temp folder.
_load_experiments_and_runs_from_temp()

for layer in layer_flags:
    _raw_file_for_layer(layer).touch(exist_ok=True)

# Seed minimal samples on startup so raw files are not empty for demo/testing scenarios.
if not metric_samples:
    restored = _load_recent_samples_from_raw(limit=200)
    if restored:
        metric_samples.extend(restored)
        for s in restored:
            try:
                seen_metric_names.add(str(s.metric))
            except Exception:
                pass

        # Fill gaps: restored raw tends to be transport-heavy, which leaves many
        # definitions without any sample. Do one synthetic pass to maximize coverage.
        topology = next(iter(topologies.values()), None)
        seeded = _collect_synthetic_full(topology, {"version": software_version})
        if seeded:
            _store_samples(seeded)
    else:
        seeded = _collect_synthetic_full(next(iter(topologies.values()), None), {"version": software_version})
        if seeded:
            _store_samples(seeded)


async def _auto_collect_loop() -> None:
    """Continuously collect metrics to keep SSE populated."""
    while True:
        try:
            topology = next(iter(topologies.values()), None)
            if topology:
                labels = {"version": software_version}
                use_real_setting = system_settings.get("use_real_data", real_collection_default)
                samples = _collect_real(topology, labels) if use_real_setting else _collect_synthetic_full(topology, labels)
                if samples:
                    _store_samples(samples)
        except Exception:
            # Avoid crashing the loop; log could be added here later.
            pass
        await asyncio.sleep(collection_interval_seconds)


@app.on_event("startup")
async def _start_auto_collect() -> None:
    global _auto_collect_task
    if _auto_collect_task is None:
        _auto_collect_task = asyncio.create_task(_auto_collect_loop())


@app.on_event("shutdown")
async def _stop_auto_collect() -> None:
    global _auto_collect_task
    if _auto_collect_task:
        _auto_collect_task.cancel()
        try:
            await _auto_collect_task
        except asyncio.CancelledError:
            pass


@app.post("/topologies", response_model=Topology, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_topology(payload: TopologyCreate) -> Topology:
    topology_id = _generate_id("topo")
    topology = Topology(id=topology_id, **payload.model_dump())
    topologies[topology_id] = topology
    return topology


@app.get("/topologies", response_model=List[Topology])
async def list_topologies() -> List[Topology]:
    return list(topologies.values())


@app.get("/topologies/{topology_id}", response_model=Topology)
async def get_topology(topology_id: str) -> Topology:
    topology = topologies.get(topology_id)
    if not topology:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topology not found")
    return topology


@app.put("/topologies/{topology_id}", response_model=Topology, dependencies=[Depends(require_api_key)])
async def update_topology(topology_id: str, payload: TopologyUpdate) -> Topology:
    existing = topologies.get(topology_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topology not found")
    update_data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    merged = existing.model_dump()
    merged.update(update_data)
    updated = Topology(id=topology_id, **merged)
    topologies[topology_id] = updated
    return updated


@app.delete("/topologies/{topology_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_api_key)])
async def delete_topology(topology_id: str) -> Response:
    if topology_id not in topologies:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topology not found")
    topologies.pop(topology_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/experiments", response_model=Experiment, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_experiment(payload: ExperimentCreate) -> Experiment:
    if payload.topology_id not in topologies:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topology not found")
    experiment_id = _generate_id("exp")
    experiment = Experiment(id=experiment_id, **payload.model_dump())
    experiments[experiment_id] = experiment
    try:
        _persist_experiment(experiment)
    except Exception:
        pass
    return experiment


@app.get("/experiments", response_model=List[Experiment])
async def list_experiments() -> List[Experiment]:
    return list(experiments.values())


@app.get("/experiments/{experiment_id}", response_model=Experiment)
async def get_experiment(experiment_id: str) -> Experiment:
    experiment = experiments.get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    return experiment


@app.put("/experiments/{experiment_id}", response_model=Experiment, dependencies=[Depends(require_api_key)])
async def update_experiment(experiment_id: str, payload: ExperimentUpdate) -> Experiment:
    existing = experiments.get(experiment_id)
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    update_data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    merged = existing.model_dump()
    merged.update(update_data)
    updated = Experiment(id=experiment_id, **merged)
    experiments[experiment_id] = updated
    try:
        _persist_experiment(updated)
    except Exception:
        pass
    return updated


@app.delete("/experiments/{experiment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_api_key)])
async def delete_experiment(experiment_id: str) -> Response:
    if experiment_id not in experiments:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    experiments.pop(experiment_id)
    try:
        _delete_persisted_experiment(experiment_id)
    except Exception:
        pass

    # Clean up any runs linked to this experiment.
    for run_id, run in list(runs.items()):
        if run.experiment_id != experiment_id:
            continue
        runs.pop(run_id, None)
        run_metrics.pop(run_id, None)
        try:
            _delete_persisted_run(run_id)
        except Exception:
            pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/experiments/{experiment_id}/export")
async def export_experiment(experiment_id: str) -> Response:
    """Return a self-contained JSON bundle (experiment + runs + metrics) for download."""
    experiment = experiments.get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")

    exp_runs = [r for r in runs.values() if r.experiment_id == experiment_id]
    bundle = {
        "version": 1,
        "exported_at": datetime.utcnow().isoformat(),
        "experiment": experiment.model_dump(mode="json"),
        "runs": [r.model_dump(mode="json") for r in exp_runs],
        "run_metrics": {
            r.id: [m.model_dump(mode="json") for m in run_metrics.get(r.id, [])]
            for r in exp_runs
        },
    }
    filename = re.sub(r"[^a-zA-Z0-9_-]+", "_", experiment.name or experiment_id).strip("_") or experiment_id
    return Response(
        content=json.dumps(bundle, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}.json"'},
    )


@app.post(
    "/experiments/import",
    response_model=Dict[str, Any],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
)
async def import_experiment(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Import a bundle produced by /experiments/{id}/export.

    A new experiment ID is always generated to avoid collisions.
    Existing topology IDs are reused when they already exist; otherwise a
    placeholder topology is created automatically.
    """
    try:
        exp_data: Dict[str, Any] = payload.get("experiment") or {}
        runs_data: List[Dict[str, Any]] = payload.get("runs") or []
        metrics_data: Dict[str, Any] = payload.get("run_metrics") or {}
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid bundle format")

    # Resolve topology
    orig_topo_id = exp_data.get("topology_id", "")
    if orig_topo_id not in topologies:
        placeholder = Topology(
            id=orig_topo_id or _generate_id("topo"),
            name=f"Imported ({orig_topo_id})",
            nodes=[],
            links=[],
        )
        topologies[placeholder.id] = placeholder
        orig_topo_id = placeholder.id

    # Create experiment with a fresh ID
    new_exp_id = _generate_id("exp")
    id_map: Dict[str, str] = {exp_data.get("id", ""): new_exp_id}
    try:
        exp = Experiment(
            id=new_exp_id,
            name=exp_data.get("name", "Imported"),
            topology_id=orig_topo_id,
            description=exp_data.get("description"),
            parameters=exp_data.get("parameters"),
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid experiment data: {exc}")

    experiments[new_exp_id] = exp
    _persist_experiment(exp)

    imported_runs: List[str] = []
    for r_data in runs_data:
        new_run_id = _generate_id("run")
        id_map[r_data.get("id", "")] = new_run_id
        try:
            run = ExperimentRun(
                id=new_run_id,
                experiment_id=new_exp_id,
                topology_id=orig_topo_id,
                status=r_data.get("status", "COMPLETED"),
                started_at=r_data.get("started_at"),
                ended_at=r_data.get("ended_at"),
                parameters=r_data.get("parameters"),
                logs=r_data.get("logs") or [],
            )
        except Exception:
            continue
        runs[new_run_id] = run
        _persist_run(run)

        # Restore metrics
        orig_run_id = r_data.get("id", "")
        raw_metrics: List[Dict[str, Any]] = metrics_data.get(orig_run_id) or []
        restored: List[MetricRecord] = []
        for m in raw_metrics:
            try:
                restored.append(MetricRecord(**m))
            except Exception:
                continue
        run_metrics[new_run_id] = restored
        _persist_run_metrics(new_run_id)
        imported_runs.append(new_run_id)

    return {
        "imported": True,
        "experiment_id": new_exp_id,
        "runs_imported": len(imported_runs),
        "id_map": id_map,
    }


@app.post(
    "/experiments/{experiment_id}/run",
    response_model=ExperimentRun,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
)
async def start_run(experiment_id: str, mode: str = "synthetic") -> ExperimentRun:
    experiment = experiments.get(experiment_id)
    if not experiment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Experiment not found")
    run_id = _generate_id("run")
    run = ExperimentRun(
        id=run_id,
        experiment_id=experiment_id,
        topology_id=experiment.topology_id,
        status="RUNNING",
        started_at=datetime.utcnow(),
        parameters={"mode": mode},
        logs=[],
    )
    runs[run_id] = run
    run_metrics.setdefault(run_id, [])

    try:
        _persist_run(run)
    except Exception:
        pass

    # Snapshot collection (scientific record): collect once and finalize the run.
    try:
        labels = {
            "run_id": run_id,
            "experiment_id": experiment_id,
            "topology_id": experiment.topology_id,
            "version": software_version,
        }
        topology = topologies.get(experiment.topology_id)
        # Usar system_settings para determinar modo de coleta
        use_real_setting = system_settings.get("use_real_data", real_collection_default)
        use_real = mode == "real" or (use_real_setting and mode != "synthetic")
        samples = _collect_real(topology, labels) if use_real else _collect_synthetic_full(topology, labels)
        _store_samples(samples)
        _append_run_log(run_id, f"metrics_collected:{len(samples)}")

        merged = run.model_dump()
        merged.update({"status": "COMPLETED", "ended_at": datetime.utcnow()})
        run = ExperimentRun(**merged)
        runs[run_id] = run
    except Exception as exc:
        _append_run_log(run_id, f"failed:{type(exc).__name__}")
        merged = run.model_dump()
        merged.update({"status": "FAILED", "ended_at": datetime.utcnow()})
        run = ExperimentRun(**merged)
        runs[run_id] = run

    try:
        _persist_run(run)
        _persist_run_metrics(run_id)
    except Exception:
        pass
    return run


@app.get("/experiments/{experiment_id}/runs", response_model=List[ExperimentRun])
async def list_runs_for_experiment(experiment_id: str) -> List[ExperimentRun]:
    return [run for run in runs.values() if run.experiment_id == experiment_id]


@app.get("/runs/{run_id}", response_model=ExperimentRun)
async def get_run(run_id: str) -> ExperimentRun:
    run = runs.get(run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run


@app.get("/runs/{run_id}/metrics", response_model=List[MetricRecord])
async def get_run_metrics(run_id: str) -> List[MetricRecord]:
    if run_id not in runs:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run_metrics.get(run_id, [])


@app.get("/system/settings")
async def get_system_settings() -> Dict[str, Any]:
    """Get current system settings (data mode, auto-collect, etc)."""
    return {
        "use_real_data": system_settings["use_real_data"],
        "auto_collect_enabled": system_settings["auto_collect_enabled"],
        "collect_interval_sec": system_settings["collect_interval_sec"],
        "real_collection_available": True,  # Indica se coleta real está disponível
    }


@app.patch("/system/settings")
async def update_system_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Update system settings. Accepts: use_real_data, auto_collect_enabled, collect_interval_sec."""
    if "use_real_data" in settings and isinstance(settings["use_real_data"], bool):
        system_settings["use_real_data"] = settings["use_real_data"]
        logger.info(f"Modo de coleta alterado: {'REAL' if settings['use_real_data'] else 'SINTÉTICO'}")
    
    if "auto_collect_enabled" in settings and isinstance(settings["auto_collect_enabled"], bool):
        system_settings["auto_collect_enabled"] = settings["auto_collect_enabled"]
        logger.info(f"Auto-coleta: {'ATIVADA' if settings['auto_collect_enabled'] else 'DESATIVADA'}")
    
    if "collect_interval_sec" in settings and isinstance(settings["collect_interval_sec"], (int, float)):
        if settings["collect_interval_sec"] > 0:
            system_settings["collect_interval_sec"] = float(settings["collect_interval_sec"])
            logger.info(f"Intervalo de coleta: {settings['collect_interval_sec']}s")
    
    return await get_system_settings()


@app.get("/metrics/definitions", response_model=List[MetricDefinition])
async def list_metric_definitions() -> List[MetricDefinition]:
    return metric_definitions


@app.post("/metrics/query", response_model=List[MetricSample])
async def query_metrics(query: MetricQuery) -> List[MetricSample]:
    return _filter_samples(query)


@app.post("/flows", response_model=FlowRule, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_api_key)])
async def create_flow(flow: FlowRule) -> FlowRule:
    if flow.topology_id not in topologies:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topology not found")
    flow_id = flow.id or _generate_id("flow")
    stored = FlowRule(**flow.model_dump(exclude={"id"}), id=flow_id)
    flows[flow_id] = stored
    return stored


@app.get("/flows", response_model=List[FlowRule])
async def list_flows(topology_id: str | None = None) -> List[FlowRule]:
    if topology_id:
        return [flow for flow in flows.values() if flow.topology_id == topology_id]
    return list(flows.values())


@app.delete("/flows/{flow_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_api_key)])
async def delete_flow(flow_id: str) -> Response:
    if flow_id not in flows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Flow not found")
    flows.pop(flow_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/stream/events")
async def stream_events() -> StreamingResponse:
    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # Helpful if served behind reverse proxies that buffer responses.
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/configs")
async def list_configs() -> List[Dict[str, Any]]:
    return _list_configs()


@app.get("/configs/active")
async def get_active_config() -> Dict[str, Any]:
    active_id = _load_active_config_id()
    return {"active": active_id}


@app.get("/configs/{config_id}")
async def get_config(config_id: str) -> Dict[str, Any]:
    return _read_config_payload(config_id)


@app.post("/configs", dependencies=[Depends(require_api_key)])
async def save_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    config_id = str(payload.get("id") or payload.get("name") or _generate_id("cfg"))
    config_id = re.sub(r"[^a-zA-Z0-9_-]+", "_", config_id.strip()).strip("_")
    if not config_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid config id")

    set_active = bool(payload.get("set_active", False))
    _write_config_payload(config_id, payload)
    if set_active:
        _set_active_config_id(config_id)
        _apply_active_config()
    return {"saved": True, "id": config_id, "active": _load_active_config_id()}


@app.post("/configs/{config_id}/activate", dependencies=[Depends(require_api_key)])
async def activate_config(config_id: str) -> Dict[str, Any]:
    _read_config_payload(config_id)
    _set_active_config_id(config_id)
    _apply_active_config()
    return {"active": config_id}


@app.delete("/configs/{config_id}", dependencies=[Depends(require_api_key)])
async def delete_config(config_id: str) -> Dict[str, Any]:
    path = _config_path_for_id(config_id)
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Config not found")
    path.unlink(missing_ok=True)
    if _load_active_config_id() == config_id:
        # Pick next available config.
        remaining = _list_configs()
        if remaining:
            _set_active_config_id(str(remaining[0]["id"]))
        else:
            active_config_path.unlink(missing_ok=True)
    return {"deleted": True}


@app.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/netmon/blocks")
async def list_netmon_blocks() -> List[Dict[str, Any]]:
    try:
        return list_grc_blocks()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc


@app.post("/netmon/ingest", response_model=Dict[str, int])
async def ingest_netmon_metrics(
    payload: Dict[str, Any] | List[Dict[str, Any]],
    run_id: str | None = None,
    experiment_id: str | None = None,
    topology_id: str | None = None,
    version: str | None = None,
) -> Dict[str, int]:
    items = payload if isinstance(payload, list) else [payload]
    labels = {"run_id": run_id, "experiment_id": experiment_id, "topology_id": topology_id, "version": version}
    stored = 0
    for item in items:
        samples = samples_from_netmon(item, labels=labels)
        if samples:
            _store_samples(samples)
            stored += len(samples)
    return {"stored": stored}


@app.post("/netmon/ping", response_model=Dict[str, Any])
async def execute_netmon_ping(
    container_name: str = "h1",
    target_ip: str = "172.18.0.3",
    timeout: float = 2.0,
    run_id: str | None = None,
    experiment_id: str | None = None,
    topology_id: str | None = None,
    version: str | None = None,
    store: bool = True,
) -> Dict[str, Any]:
    try:
        payload = run_host_ping(container_name, target_ip, timeout)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    payload["ts"] = time.time()
    payload["ts_iso"] = datetime.utcnow().isoformat()
    if store:
        labels = {"run_id": run_id, "experiment_id": experiment_id, "topology_id": topology_id, "version": version}
        samples = samples_from_netmon(payload, labels=labels)
        if samples:
            _store_samples(samples)
    return payload


@app.post("/metrics/samples", response_model=Dict[str, int], status_code=status.HTTP_201_CREATED)
async def ingest_samples(payload: MetricSample | List[MetricSample]) -> Dict[str, int]:
    samples: List[MetricSample]
    if isinstance(payload, list):
        samples = payload
    else:
        samples = [payload]
    _store_samples(samples)
    return {"stored": len(samples)}


@app.get("/metrics/latest", response_model=List[MetricSample])
async def latest_metrics(metric: str | None = None, node: str | None = None, layer: MetricLayer | None = None) -> List[MetricSample]:
    filtered = [s for s in metric_samples if (not metric or s.metric == metric) and (not node or s.node == node) and (not layer or s.layer == layer)]
    latest_by_key: Dict[str, MetricSample] = {}
    for sample in filtered:
        key = f"{sample.metric}:{sample.node}:{sample.layer}"
        current = latest_by_key.get(key)
        if not current or sample.timestamp > current.timestamp:
            latest_by_key[key] = sample
    return list(latest_by_key.values())


@app.get("/metrics/export")
async def export_metrics(layer: MetricLayer | None = None) -> Response:
    path = _raw_file_for_layer(layer or "network") if layer else None
    if path and path.exists():
        content = path.read_text(encoding="utf-8")
        return Response(content=content, media_type="text/plain")
    # Fallback to in-memory export
    lines = [_serialize_sample(s) for s in metric_samples if not layer or s.layer == layer]
    return Response(content="\n".join(lines), media_type="text/plain")


@app.post("/metrics/collect", response_model=Dict[str, int], dependencies=[Depends(require_api_key)])
async def collect_metrics(
    mode: str = "synthetic",
    run_id: str | None = None,
    experiment_id: str | None = None,
    topology_id: str | None = None,
    version: str | None = None,
) -> Dict[str, int]:
    labels = {k: v for k, v in {"run_id": run_id, "experiment_id": experiment_id, "topology_id": topology_id, "version": version}.items() if v is not None}
    topology = topologies.get(topology_id) if topology_id else next(iter(topologies.values()), None)
    use_real_setting = system_settings.get("use_real_data", real_collection_default)
    use_real = mode == "real" or (use_real_setting and mode != "synthetic")
    samples = _collect_real(topology, labels) if use_real else _collect_synthetic_full(topology, labels)
    _store_samples(samples)
    if run_id:
        _append_run_log(run_id, "metrics_collected")
    return {"collected": len(samples), "mode": "real" if use_real else "synthetic"}

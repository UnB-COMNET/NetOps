from __future__ import annotations

import re
import sys
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional

from platform.backend.core.metrics import ensure_labels, to_metric_sample
from platform.backend.schemas import MetricDefinition, MetricLayer, MetricSample

_NETMON_PY_PATH = Path("gr-netmon") / "python"
if _NETMON_PY_PATH.exists():
    sys.path.insert(0, str(_NETMON_PY_PATH.resolve()))


def netmon_metric_definitions() -> List[MetricDefinition]:
    return [
        MetricDefinition(
            name="host_ping_latency_ms",
            description="Latência ICMP (ping) coletada via bloco netmon",
            unit="ms",
            layer="network",
            kind="gauge",
            category="netmon",
            tags=["netmon", "host_ping"],
            dimensions=["src", "dst", "container"],
        ),
        MetricDefinition(
            name="host_ping_ok",
            description="Sucesso do ping (1=ok, 0=erro)",
            unit="bool",
            layer="network",
            kind="gauge",
            category="netmon",
            tags=["netmon", "host_ping"],
            dimensions=["src", "dst", "container"],
        ),
        MetricDefinition(
            name="dns_latency_ms",
            description="Latência de resolução DNS via bloco netmon",
            unit="ms",
            layer="application",
            kind="gauge",
            category="netmon",
            tags=["netmon", "dns_resolver"],
            dimensions=["server", "query"],
        ),
        MetricDefinition(
            name="dns_ok",
            description="Sucesso da resolução DNS (1=ok, 0=erro)",
            unit="bool",
            layer="application",
            kind="gauge",
            category="netmon",
            tags=["netmon", "dns_resolver"],
            dimensions=["server", "query"],
        ),
        MetricDefinition(
            name="docker_cpu_util_pct",
            description="CPU % por container (docker stats)",
            unit="%",
            layer="control",
            kind="gauge",
            category="netmon",
            tags=["netmon", "docker_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="docker_mem_util_pct",
            description="Memória % por container (docker stats)",
            unit="%",
            layer="control",
            kind="gauge",
            category="netmon",
            tags=["netmon", "docker_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="docker_mem_used_bytes",
            description="Memória usada por container (docker stats)",
            unit="bytes",
            layer="control",
            kind="gauge",
            category="netmon",
            tags=["netmon", "docker_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="docker_net_rx_bytes",
            description="Bytes recebidos por container (docker stats)",
            unit="bytes",
            layer="control",
            kind="counter",
            category="netmon",
            tags=["netmon", "docker_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="docker_net_tx_bytes",
            description="Bytes enviados por container (docker stats)",
            unit="bytes",
            layer="control",
            kind="counter",
            category="netmon",
            tags=["netmon", "docker_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="docker_block_read_bytes",
            description="Bytes lidos em disco (docker stats)",
            unit="bytes",
            layer="control",
            kind="counter",
            category="netmon",
            tags=["netmon", "docker_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="docker_block_write_bytes",
            description="Bytes escritos em disco (docker stats)",
            unit="bytes",
            layer="control",
            kind="counter",
            category="netmon",
            tags=["netmon", "docker_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="link_rx_bytes",
            description="Bytes recebidos por interface (netmon link)",
            unit="bytes",
            layer="link",
            kind="counter",
            category="netmon",
            tags=["netmon", "link_interface_stats"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="link_tx_bytes",
            description="Bytes enviados por interface (netmon link)",
            unit="bytes",
            layer="link",
            kind="counter",
            category="netmon",
            tags=["netmon", "link_interface_stats"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="link_rx_packets",
            description="Pacotes recebidos por interface (netmon link)",
            unit="packets",
            layer="link",
            kind="counter",
            category="netmon",
            tags=["netmon", "link_interface_stats"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="link_tx_packets",
            description="Pacotes enviados por interface (netmon link)",
            unit="packets",
            layer="link",
            kind="counter",
            category="netmon",
            tags=["netmon", "link_interface_stats"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="link_rx_errors",
            description="Erros RX por interface (netmon link)",
            unit="count",
            layer="link",
            kind="counter",
            category="netmon",
            tags=["netmon", "link_interface_stats"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="link_tx_errors",
            description="Erros TX por interface (netmon link)",
            unit="count",
            layer="link",
            kind="counter",
            category="netmon",
            tags=["netmon", "link_interface_stats"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="transport_tcp_in_segs",
            description="TCP InSegs (netmon transport)",
            unit="count",
            layer="transport",
            kind="counter",
            category="netmon",
            tags=["netmon", "transport_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="transport_tcp_out_segs",
            description="TCP OutSegs (netmon transport)",
            unit="count",
            layer="transport",
            kind="counter",
            category="netmon",
            tags=["netmon", "transport_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="transport_tcp_retrans_segs",
            description="TCP RetransSegs (netmon transport)",
            unit="count",
            layer="transport",
            kind="counter",
            category="netmon",
            tags=["netmon", "transport_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="transport_udp_in_datagrams",
            description="UDP InDatagrams (netmon transport)",
            unit="count",
            layer="transport",
            kind="counter",
            category="netmon",
            tags=["netmon", "transport_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="transport_udp_out_datagrams",
            description="UDP OutDatagrams (netmon transport)",
            unit="count",
            layer="transport",
            kind="counter",
            category="netmon",
            tags=["netmon", "transport_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="transport_udp_in_errors",
            description="UDP InErrors (netmon transport)",
            unit="count",
            layer="transport",
            kind="counter",
            category="netmon",
            tags=["netmon", "transport_stats"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="forwarding_flow_packets",
            description="Pacotes por fluxo (netmon forwarding)",
            unit="packets",
            layer="dataplane",
            kind="counter",
            category="netmon",
            tags=["netmon", "forwarding_table_s1"],
            dimensions=["container", "priority", "actions"],
        ),
        MetricDefinition(
            name="forwarding_flow_bytes",
            description="Bytes por fluxo (netmon forwarding)",
            unit="bytes",
            layer="dataplane",
            kind="counter",
            category="netmon",
            tags=["netmon", "forwarding_table_s1"],
            dimensions=["container", "priority", "actions"],
        ),
        MetricDefinition(
            name="forwarding_flow_d_packets",
            description="Delta de pacotes por fluxo (netmon forwarding)",
            unit="packets",
            layer="dataplane",
            kind="gauge",
            category="netmon",
            tags=["netmon", "forwarding_table_s1"],
            dimensions=["container", "priority", "actions"],
        ),
        MetricDefinition(
            name="forwarding_flow_d_bytes",
            description="Delta de bytes por fluxo (netmon forwarding)",
            unit="bytes",
            layer="dataplane",
            kind="gauge",
            category="netmon",
            tags=["netmon", "forwarding_table_s1"],
            dimensions=["container", "priority", "actions"],
        ),
        MetricDefinition(
            name="openflow_session_snapshot",
            description="Snapshot de sessão OpenFlow (1=ok)",
            unit="bool",
            layer="control",
            kind="gauge",
            category="netmon",
            tags=["netmon", "openflow_session"],
            dimensions=["container"],
        ),
        MetricDefinition(
            name="ip_header_capture_packets",
            description="Pacotes capturados via tcpdump (netmon)",
            unit="packets",
            layer="network",
            kind="counter",
            category="netmon",
            tags=["netmon", "ip_header_capture"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="ip_header_capture_lines",
            description="Linhas capturadas via tcpdump (netmon)",
            unit="count",
            layer="network",
            kind="counter",
            category="netmon",
            tags=["netmon", "ip_header_capture"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="pcap_exporter_files",
            description="Arquivos PCAP gerados (netmon)",
            unit="count",
            layer="network",
            kind="counter",
            category="netmon",
            tags=["netmon", "pcap_exporter"],
            dimensions=["container", "interface"],
        ),
        MetricDefinition(
            name="alerts_count",
            description="Quantidade de alertas gerados (netmon)",
            unit="count",
            layer="service",
            kind="counter",
            category="netmon",
            tags=["netmon", "alerts"],
            dimensions=["source"],
        ),
    ]


_SIZE_UNITS: Dict[str, float] = {
    "B": 1.0,
    "KB": 1000.0,
    "MB": 1000.0 ** 2,
    "GB": 1000.0 ** 3,
    "TB": 1000.0 ** 4,
    "KIB": 1024.0,
    "MIB": 1024.0 ** 2,
    "GIB": 1024.0 ** 3,
    "TIB": 1024.0 ** 4,
}


def _parse_percent(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("%", "")
    try:
        return float(text)
    except ValueError:
        return None


def _parse_size(value: Any) -> Optional[float]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    match = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)$", text)
    if not match:
        return None
    number = float(match.group(1))
    unit = match.group(2).upper()
    factor = _SIZE_UNITS.get(unit)
    if factor is None:
        return None
    return number * factor


def _parse_pair(value: Any) -> tuple[Optional[float], Optional[float]]:
    if value is None:
        return None, None
    text = str(value)
    if "/" not in text:
        return _parse_size(text), None
    left, right = [x.strip() for x in text.split("/", 1)]
    return _parse_size(left), _parse_size(right)


def _parse_timestamp(payload: Mapping[str, Any]) -> Optional[datetime]:
    ts_iso = payload.get("ts_iso")
    if isinstance(ts_iso, str):
        try:
            return datetime.fromisoformat(ts_iso)
        except ValueError:
            pass
    ts = payload.get("ts")
    if isinstance(ts, (int, float)):
        try:
            return datetime.utcfromtimestamp(float(ts))
        except Exception:
            pass
    return None


def _base_labels(labels: Optional[Mapping[str, Any]], module: str | None) -> Dict[str, Any]:
    merged = dict(labels or {})
    if module:
        merged.setdefault("collector", module)
    return ensure_labels(merged)


def samples_from_netmon(payload: Mapping[str, Any], labels: Optional[Mapping[str, Any]] = None) -> List[MetricSample]:
    module = str(payload.get("module")) if payload.get("module") else None
    ts = _parse_timestamp(payload)
    base = _base_labels(labels, module)
    samples: List[MetricSample] = []

    if module == "host_ping":
        container = payload.get("container") or payload.get("host") or "unknown"
        target_ip = payload.get("target_ip")
        latency_s = payload.get("latency_s")
        ok = bool(payload.get("ok"))
        if latency_s is not None:
            samples.append(
                to_metric_sample(
                    "host_ping_latency_ms",
                    node=str(container),
                    value=float(latency_s) * 1000.0,
                    layer="network",
                    timestamp=ts,
                    labels=base,
                    details={"target_ip": target_ip, "ok": ok, "mode": payload.get("mode")},
                )
            )
        samples.append(
            to_metric_sample(
                "host_ping_ok",
                node=str(container),
                value=1.0 if ok else 0.0,
                layer="network",
                timestamp=ts,
                labels=base,
                details={"target_ip": target_ip, "mode": payload.get("mode")},
            )
        )

    elif module == "dns_resolver":
        server = payload.get("server")
        query = payload.get("query")
        latency_s = payload.get("latency_s")
        ok = bool(payload.get("ok"))
        if latency_s is not None:
            samples.append(
                to_metric_sample(
                    "dns_latency_ms",
                    node=str(server or "dns"),
                    value=float(latency_s) * 1000.0,
                    layer="application",
                    timestamp=ts,
                    labels=base,
                    details={"server": server, "query": query, "ok": ok},
                )
            )
        samples.append(
            to_metric_sample(
                "dns_ok",
                node=str(server or "dns"),
                value=1.0 if ok else 0.0,
                layer="application",
                timestamp=ts,
                labels=base,
                details={"server": server, "query": query},
            )
        )

    elif module == "docker_stats":
        for item in payload.get("containers", []) or []:
            name = item.get("Name") or item.get("name") or "container"
            cpu = _parse_percent(item.get("CPUPerc"))
            mem_pct = _parse_percent(item.get("MemPerc"))
            mem_used, _mem_total = _parse_pair(item.get("MemUsage"))
            net_rx, net_tx = _parse_pair(item.get("NetIO"))
            block_read, block_write = _parse_pair(item.get("BlockIO"))
            details = {"container": name}
            if cpu is not None:
                samples.append(to_metric_sample("docker_cpu_util_pct", str(name), cpu, layer="control", timestamp=ts, labels=base, details=details))
            if mem_pct is not None:
                samples.append(to_metric_sample("docker_mem_util_pct", str(name), mem_pct, layer="control", timestamp=ts, labels=base, details=details))
            if mem_used is not None:
                samples.append(to_metric_sample("docker_mem_used_bytes", str(name), mem_used, layer="control", timestamp=ts, labels=base, details=details))
            if net_rx is not None:
                samples.append(to_metric_sample("docker_net_rx_bytes", str(name), net_rx, layer="control", timestamp=ts, labels=base, details=details))
            if net_tx is not None:
                samples.append(to_metric_sample("docker_net_tx_bytes", str(name), net_tx, layer="control", timestamp=ts, labels=base, details=details))
            if block_read is not None:
                samples.append(to_metric_sample("docker_block_read_bytes", str(name), block_read, layer="control", timestamp=ts, labels=base, details=details))
            if block_write is not None:
                samples.append(to_metric_sample("docker_block_write_bytes", str(name), block_write, layer="control", timestamp=ts, labels=base, details=details))

    elif module == "link_interface_stats":
        container = payload.get("container") or "container"
        for iface in payload.get("ifaces", []) or []:
            name = iface.get("iface")
            details = {"interface": name}
            for metric, key in [
                ("link_rx_bytes", "rx_bytes"),
                ("link_tx_bytes", "tx_bytes"),
                ("link_rx_packets", "rx_packets"),
                ("link_tx_packets", "tx_packets"),
                ("link_rx_errors", "rx_errors"),
                ("link_tx_errors", "tx_errors"),
            ]:
                value = iface.get(key)
                if value is None:
                    continue
                samples.append(
                    to_metric_sample(
                        metric,
                        node=str(container),
                        value=float(value),
                        layer="link",
                        timestamp=ts,
                        labels=base,
                        details=details,
                    )
                )

    elif module == "transport_stats":
        container = payload.get("container") or "container"
        snmp = payload.get("snmp") or {}
        tcp = snmp.get("tcp") or {}
        udp = snmp.get("udp") or {}
        tcp_map = {
            "InSegs": "transport_tcp_in_segs",
            "OutSegs": "transport_tcp_out_segs",
            "RetransSegs": "transport_tcp_retrans_segs",
        }
        udp_map = {
            "InDatagrams": "transport_udp_in_datagrams",
            "OutDatagrams": "transport_udp_out_datagrams",
            "InErrors": "transport_udp_in_errors",
        }
        for key, metric in tcp_map.items():
            value = tcp.get(key)
            if value is not None:
                samples.append(to_metric_sample(metric, str(container), float(value), layer="transport", timestamp=ts, labels=base, details={"protocol": "tcp"}))
        for key, metric in udp_map.items():
            value = udp.get(key)
            if value is not None:
                samples.append(to_metric_sample(metric, str(container), float(value), layer="transport", timestamp=ts, labels=base, details={"protocol": "udp"}))

    elif module == "forwarding_table_s1":
        container = payload.get("container") or "s1"
        bridge = payload.get("bridge")
        for flow in payload.get("flows", []) or []:
            details = {"priority": flow.get("priority"), "actions": flow.get("actions"), "bridge": bridge}
            for metric, key in [
                ("forwarding_flow_packets", "n_packets"),
                ("forwarding_flow_bytes", "n_bytes"),
                ("forwarding_flow_d_packets", "d_packets"),
                ("forwarding_flow_d_bytes", "d_bytes"),
            ]:
                value = flow.get(key)
                if value is None:
                    continue
                samples.append(to_metric_sample(metric, str(container), float(value), layer="dataplane", timestamp=ts, labels=base, details=details))

    elif module == "openflow_session":
        container = payload.get("container") or "s1"
        samples.append(
            to_metric_sample(
                "openflow_session_snapshot",
                node=str(container),
                value=1.0,
                layer="control",
                timestamp=ts,
                labels=base,
                details={"raw": payload.get("raw")},
            )
        )

    elif module == "ip_header_capture":
        container = payload.get("container") or "container"
        interface = payload.get("interface")
        details = {"interface": interface, "filter": payload.get("filter")}
        count = payload.get("count")
        lines = payload.get("lines")
        if count is not None:
            samples.append(to_metric_sample("ip_header_capture_packets", str(container), float(count), layer="network", timestamp=ts, labels=base, details=details))
        if lines is not None:
            samples.append(to_metric_sample("ip_header_capture_lines", str(container), float(lines), layer="network", timestamp=ts, labels=base, details=details))

    elif module == "pcap_exporter":
        container = payload.get("container") or "container"
        interface = payload.get("interface")
        details = {"interface": interface, "filename": payload.get("filename"), "ok": bool(payload.get("ok", True))}
        samples.append(to_metric_sample("pcap_exporter_files", str(container), 1.0, layer="network", timestamp=ts, labels=base, details=details))

    elif module == "alerts":
        count = payload.get("count")
        if count is None:
            count = len(payload.get("alerts") or [])
        samples.append(to_metric_sample("alerts_count", node=str(payload.get("source") or "alerts"), value=float(count or 0), layer="service", timestamp=ts, labels=base, details={"alerts": payload.get("alerts")}))

    return samples


def _run_cmd(cmd: List[str], timeout: int) -> tuple[str, str]:
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return result.stdout.strip(), result.stderr.strip()
    except subprocess.TimeoutExpired:
        return "", "timeout"
    except Exception as exc:  # pragma: no cover
        return "", str(exc)


def _parse_ping_once(out: str) -> float:
    if "time=" in out:
        try:
            pos = out.rfind("time=")
            ms_part = out[pos + 5 :]
            ms_val = ms_part.split()[0]
            if ms_val.endswith("ms"):
                ms_val = ms_val[:-2]
            return float(ms_val) / 1000.0
        except Exception:
            pass
    if "rtt min/avg/max/mdev" in out:
        try:
            seg = out.split("=")[-1].strip()
            avg_ms = seg.split("/")[1]
            return float(avg_ms) / 1000.0
        except Exception:
            pass
    return -1.0


def run_host_ping(container_name: str, target_ip: str, timeout: float) -> Dict[str, Any]:
    cmd = ["docker", "exec", container_name, "ping", "-c", "1", "-W", str(int(timeout)), target_ip]
    out, _err = _run_cmd(cmd, timeout=int(timeout) + 2)
    latency = _parse_ping_once(out)
    ok = bool(latency >= 0.0)
    return {
        "module": "host_ping",
        "mode": "api",
        "container": container_name,
        "target_ip": target_ip,
        "latency_s": float(latency),
        "ok": ok,
    }

import asyncio
import importlib.util
import types
from pathlib import Path
import pytest

MODULE_PATH = Path(__file__).resolve().parents[1] / "monitor copy.py"
spec = importlib.util.spec_from_file_location("monitor_copy_mod", MODULE_PATH)
monc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monc)


def test_throughput_test_handles_missing():
    monc.iperf3 = None
    assert "error" in monc.throughput_test("1.1.1.1", 1, False, 5201)


def test_capture_packets_handles_missing():
    monc.pyshark = None
    assert "error" in monc.capture_packets("eth0", 1)


@pytest.mark.asyncio
async def test_monitor_copy_single_iteration(monkeypatch):
    monc.CONFIG = {
        "containers": [],
        "STATIC_HOSTS": {"h1": "1.1.1.1"},
        "protocols": ["icmp"],
        "ports": {"h1": {"tcp": 80, "udp": 53}},
        "interval_sec": 0.0,
        "icmp_count": 1,
        "timeout_sec": 0.1,
        "controller_api": {"enabled": False, "name": "h1", "endpoints": []},
        "throughput": {"enabled": False, "client_node": "h1", "server_node": "h1", "duration_sec": 1, "udp": False, "port": 5201},
        "capture": {"enabled": False, "interface": "eth0", "packet_count": 1},
        "export_csv": None,
        "export_json": None,
        "prometheus_pushgateway": None,
        "job_name": "test",
    }

    async def fake_probe(host, count, timeout):
        return {"ok": True, "avg_ms": 1.0, "jitter_ms": 0.0, "loss_pct": 0.0, "samples": [1.0], "error": ""}

    async def fake_tcp(host, port, attempts, timeout):
        return {"ok": True, "avg_ms": 1.0, "jitter_ms": 0.0, "success_rate_pct": 100.0}

    async def fake_udp(host, port, attempts, timeout):
        return {"ok": True, "avg_ms": 1.0, "jitter_ms": 0.0}

    monkeypatch.setattr(monc, "probe_icmp", fake_probe)
    monkeypatch.setattr(monc, "probe_tcp", fake_tcp)
    monkeypatch.setattr(monc, "probe_udp", fake_udp)
    monkeypatch.setattr(monc, "system_metrics", lambda: {})
    monkeypatch.setattr(monc, "resolve_container_ips", lambda names: {})

    class DummyExporter:
        def __init__(self, *a, **k):
            self.rows = []
            self.registry = None
        def write_row(self, *a, **k):
            self.rows.append((a, k))
        def push_prometheus(self):
            return None

    monkeypatch.setattr(monc, "Exporter", DummyExporter)

    async def fake_sleep(interval):
        raise StopAsyncIteration()

    monkeypatch.setattr(monc.asyncio, "sleep", fake_sleep)

    with pytest.raises(StopAsyncIteration):
        await monc.monitor()


@pytest.mark.asyncio
async def test_monitor_copy_with_throughput_and_capture(monkeypatch):
    monc.CONFIG = {
        "containers": [],
        "STATIC_HOSTS": {"h1": "1.1.1.1", "h2": "2.2.2.2"},
        "protocols": ["icmp", "tcp", "udp"],
        "ports": {"h1": {"tcp": 80, "udp": 53}, "h2": {"tcp": 80, "udp": 53}},
        "interval_sec": 0.0,
        "icmp_count": 1,
        "timeout_sec": 0.1,
        "controller_api": {"enabled": True, "name": "h1", "endpoints": ["e1"]},
        "throughput": {"enabled": True, "client_node": "h1", "server_node": "h2", "duration_sec": 1, "udp": False, "port": 5201},
        "capture": {"enabled": True, "interface": "eth0", "packet_count": 1},
        "export_csv": None,
        "export_json": None,
        "prometheus_pushgateway": None,
        "job_name": "test",
    }

    async def fake_probe(*args, **kwargs):
        return {"ok": True, "avg_ms": 1.0, "jitter_ms": 0.0, "loss_pct": 0.0, "samples": [1.0], "error": ""}

    async def fake_tcp(*args, **kwargs):
        return {"ok": True, "avg_ms": 1.0, "jitter_ms": 0.0, "success_rate_pct": 100.0}

    async def fake_udp(*args, **kwargs):
        return {"ok": True, "avg_ms": 1.0, "jitter_ms": 0.0}

    monkeypatch.setattr(monc, "probe_icmp", fake_probe)
    monkeypatch.setattr(monc, "probe_tcp", fake_tcp)
    monkeypatch.setattr(monc, "probe_udp", fake_udp)
    monkeypatch.setattr(monc, "resolve_container_ips", lambda names: {})
    async def fake_controller(ip, port, eps, timeout):
        return {"e1": {"ok": True}}

    monkeypatch.setattr(monc, "controller_status", fake_controller)
    monkeypatch.setattr(monc, "system_metrics", lambda: {"cpu_pct": 10})
    monkeypatch.setattr(monc, "throughput_test", lambda *a, **k: {"proto": "tcp", "sent_Mbps": 1, "received_Mbps": 1})
    monkeypatch.setattr(monc, "capture_packets", lambda *a, **k: {"tcp": 1, "udp": 1, "icmp": 1, "other": 0, "total": 3})

    class Gauge:
        def labels(self, **kwargs):
            return self
        def set(self, value):
            self.last = value

    class DummyExporter:
        def __init__(self, *a, **k):
            self.rows = []
            self.registry = True
            self.g_latency = Gauge()
            self.g_loss = Gauge()
            self.g_tcp_success = Gauge()
        def write_row(self, *a, **k):
            self.rows.append((a, k))
        def push_prometheus(self):
            return None

    monkeypatch.setattr(monc, "Exporter", DummyExporter)

    async def fake_sleep(interval):
        raise StopAsyncIteration()

    monkeypatch.setattr(monc.asyncio, "sleep", fake_sleep)

    with pytest.raises(StopAsyncIteration):
        await monc.monitor()

import asyncio
import types
import pytest

import monitor as mon


@pytest.mark.asyncio
async def test_run_cmd_success():
    code, out, err = await mon.run_cmd("echo hi", timeout=1)
    assert code == 0
    assert "hi" in out


def test_safe_mean_stdev():
    assert mon.safe_mean([1, 2]) == 1.5
    assert mon.safe_stdev([1, 3]) > 0
    assert mon.safe_stdev([]) == 0.0


@pytest.mark.asyncio
async def test_probe_icmp(monkeypatch):
    async def fake_run(cmd, timeout):
        text = "64 bytes time=1.0 ms\n3 packets transmitted, 3 received, 0% packet loss"
        return 0, text, ""
    monkeypatch.setattr(mon, "run_cmd", fake_run)
    res = await mon.probe_icmp("1.1.1.1", count=2, timeout=0.1)
    assert res["ok"] and res["avg_ms"] > 0


@pytest.mark.asyncio
async def test_probe_tcp(monkeypatch):
    async def fake_wait_for(coro, timeout):
        return await coro

    async def fake_open_connection(host, port):
        class Writer:
            def close(self):
                pass
            async def wait_closed(self):
                return None
        return object(), Writer()

    monkeypatch.setattr(asyncio, "wait_for", fake_wait_for)
    monkeypatch.setattr(asyncio, "open_connection", fake_open_connection)
    res = await mon.probe_tcp("1.1.1.1", port=80, attempts=2, timeout=0.1)
    assert res["ok"]


@pytest.mark.asyncio
async def test_probe_udp(monkeypatch):
    class Loop:
        async def run_in_executor(self, executor, func, *args):
            func()
            return None
    monkeypatch.setattr(asyncio, "get_event_loop", lambda: Loop())
    res = await mon.probe_udp("1.1.1.1", port=53, attempts=2, timeout=0.1)
    assert res["ok"]


def test_system_metrics_with_stub(monkeypatch):
    class DummyNet:
        bytes_sent = 1
        bytes_recv = 2

    class DummyPsutil:
        @staticmethod
        def net_io_counters(pernic=False):
            return DummyNet()

        @staticmethod
        def cpu_percent(interval=None):
            return 10.0

        @staticmethod
        def virtual_memory():
            return types.SimpleNamespace(percent=20.0)

    monkeypatch.setattr(mon, "psutil", DummyPsutil)
    out = mon.system_metrics()
    assert out["cpu_pct"] == 10.0


@pytest.mark.asyncio
async def test_monitor_single_iteration(monkeypatch):
    # Minimal config to keep the loop light
    mon.CONFIG = {
        "containers": [],
        "STATIC_HOSTS": {"h1": "1.1.1.1"},
        "protocols": ["icmp"],
        "ports": {"h1": {"tcp": 80, "udp": 53}},
        "interval_sec": 0.0,
        "icmp_count": 1,
        "timeout_sec": 0.1,
        "controller_api": {"enabled": False, "name": "h1", "base_path": "/", "endpoints": []},
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

    monkeypatch.setattr(mon, "probe_icmp", fake_probe)
    monkeypatch.setattr(mon, "probe_tcp", fake_tcp)
    monkeypatch.setattr(mon, "probe_udp", fake_udp)
    monkeypatch.setattr(mon, "system_metrics", lambda: {})
    monkeypatch.setattr(mon, "resolve_container_ips", lambda names: {})

    class DummyExporter:
        def __init__(self, *a, **k):
            self.rows = []
            self.registry = None
        def write_row(self, *a, **k):
            self.rows.append((a, k))
        def push_prometheus(self):
            return None

    monkeypatch.setattr(mon, "Exporter", DummyExporter)

    async def fake_sleep(interval):
        raise StopAsyncIteration()

    monkeypatch.setattr(mon.asyncio, "sleep", fake_sleep)

    with pytest.raises(StopAsyncIteration):
        await mon.monitor()


@pytest.mark.asyncio
async def test_monitor_with_controller_and_registry(monkeypatch):
    mon.CONFIG = {
        "containers": [],
        "STATIC_HOSTS": {"h1": "1.1.1.1"},
        "protocols": ["icmp", "tcp", "udp"],
        "ports": {"h1": {"tcp": 80, "udp": 53}},
        "interval_sec": 0.0,
        "icmp_count": 1,
        "timeout_sec": 0.1,
        "controller_api": {"enabled": True, "name": "h1", "base_path": "/", "endpoints": ["e1"]},
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

    monkeypatch.setattr(mon, "probe_icmp", fake_probe)
    monkeypatch.setattr(mon, "probe_tcp", fake_tcp)
    monkeypatch.setattr(mon, "probe_udp", fake_udp)
    monkeypatch.setattr(mon, "resolve_container_ips", lambda names: {})
    async def fake_controller(ip, port, eps, timeout):
        return {"e1": {"ok": True}}

    monkeypatch.setattr(mon, "controller_status", fake_controller)
    monkeypatch.setattr(mon, "system_metrics", lambda: {"cpu_pct": 10})

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

    monkeypatch.setattr(mon, "Exporter", DummyExporter)

    async def fake_sleep(interval):
        raise StopAsyncIteration()

    monkeypatch.setattr(mon.asyncio, "sleep", fake_sleep)

    with pytest.raises(StopAsyncIteration):
        await mon.monitor()

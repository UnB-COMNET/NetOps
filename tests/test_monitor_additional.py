import types
import sys
import asyncio
from pathlib import Path

import monitor as mon


def test_run_cmd_handles_exception(monkeypatch):
    async def boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(mon.asyncio, "create_subprocess_exec", boom)
    code, out, err = asyncio.run(mon.run_cmd("echo hi", timeout=0.1))
    assert code == -1
    assert "boom" in err
    assert out == ""


def test_resolve_container_ips_with_docker(monkeypatch):
    class FakeContainer:
        def __init__(self):
            self.attrs = {"NetworkSettings": {"Networks": {"n1": {"IPAddress": "10.0.0.2"}}}}

    class FakeContainers:
        def get(self, name):
            return FakeContainer()

    class FakeClient:
        def __init__(self):
            self.containers = FakeContainers()

    fake_docker = types.SimpleNamespace(from_env=lambda: FakeClient())
    monkeypatch.setattr(mon, "docker", fake_docker)
    ips = mon.resolve_container_ips(["c1"])
    assert ips == {"c1": "10.0.0.2"}


def test_controller_status_error(monkeypatch):
    class FailingSession:
        async def __aenter__(self):
            raise RuntimeError("boom")

        async def __aexit__(self, exc_type, exc, tb):
            return False

    fake_mod = types.SimpleNamespace(ClientSession=FailingSession)
    monkeypatch.setitem(sys.modules, "aiohttp", fake_mod)
    result = asyncio.run(mon.controller_status("1.1.1.1", 80, ["e1"], timeout=0.1))
    assert result.get("error")


def test_controller_status_parses_json(monkeypatch):
    class FakeResponse:
        def __init__(self, text, status=200):
            self._text = text
            self.status = status

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def text(self):
            return self._text

    class FakeSession:
        def __init__(self):
            self.requests = []

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def get(self, url, timeout=None):
            self.requests.append(url)
            return FakeResponse('{"ok": true}')

    fake_mod = types.SimpleNamespace(ClientSession=FakeSession)
    monkeypatch.setitem(sys.modules, "aiohttp", fake_mod)
    result = asyncio.run(mon.controller_status("1.1.1.1", 80, ["e1"], timeout=0.1))
    assert result.get("e1", {}).get("ok") is True


def test_exporter_writes_and_pushes(monkeypatch, tmp_path):
    pushed = {}

    class DummyGauge:
        def __init__(self, *a, **k):
            self.value = None

        def labels(self, *a, **k):
            return self

        def set(self, value):
            self.value = value

    class DummyRegistry:
        pass

    monkeypatch.setattr(mon, "Gauge", DummyGauge)
    monkeypatch.setattr(mon, "CollectorRegistry", DummyRegistry)
    monkeypatch.setattr(mon, "push_to_gateway", lambda pgw, job, registry: pushed.setdefault("called", True))

    csv_path = tmp_path / "m.csv"
    jsonl_path = tmp_path / "m.jsonl"
    exp = mon.Exporter(str(csv_path), str(jsonl_path), "http://pgw", "job")
    exp.write_row("ts", "node", "layer", "metric", 1.23, {"d": 1})
    exp.push_prometheus()

    csv_content = csv_path.read_text().strip().splitlines()
    assert len(csv_content) == 2  # header + row
    assert "metric" in csv_content[1]

    json_lines = jsonl_path.read_text().strip().splitlines()
    assert len(json_lines) == 1
    assert "metric" in json_lines[0]
    assert pushed.get("called") is True


def test_system_metrics_handles_missing_psutil(monkeypatch):
    monkeypatch.setattr(mon, "psutil", None)
    assert mon.system_metrics() == {}

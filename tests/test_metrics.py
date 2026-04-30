import os
import builtins
import types
from pathlib import Path

import netmon.metrics as metrics


def test_resolve_log_dir_creates(tmp_path, monkeypatch):
    target = tmp_path / "logs"
    path = metrics.resolve_log_dir(target)
    assert Path(path).exists()


def test_resolve_log_dir_ignores_errors(monkeypatch):
    calls = {}

    def boom(*args, **kwargs):
        calls["called"] = True
        raise OSError("fail")

    monkeypatch.setattr(metrics.os, "makedirs", boom)
    out = metrics.resolve_log_dir("/dev/null/should/not/exist")
    assert calls["called"] is True
    assert out.endswith("should/not/exist")


def test_now_ts_returns_epoch_and_iso():
    epoch, iso = metrics.now_ts()
    assert isinstance(epoch, float)
    assert "T" in iso and iso.count(":") >= 2


def test_emit_json_publishes(monkeypatch):
    published = []

    class DummyBlock:
        def message_port_pub(self, port, payload):
            published.append((port, payload))

    monkeypatch.setattr(metrics, "pmt", types.SimpleNamespace(
        intern=lambda x: x,
        to_pmt=lambda x: x,
    ))
    b = DummyBlock()
    metrics.emit_json(b, "metrics", {"ok": True})
    assert published and published[0][0] == "metrics"


def test_emit_json_swallows_errors(monkeypatch):
    class DummyBlock:
        def message_port_pub(self, port, payload):
            raise RuntimeError("boom")

    monkeypatch.setattr(metrics, "pmt", types.SimpleNamespace(
        intern=lambda x: x,
        to_pmt=lambda x: x,
    ))
    # Should not raise
    metrics.emit_json(DummyBlock(), "metrics", {"ok": False})

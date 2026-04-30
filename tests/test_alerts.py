import time
import netmon.alerts as alerts


def test_alerts_detects_latency(tmp_path, monkeypatch):
    log = tmp_path / "host_ping_auto.txt"
    lines = ["[t] latency=0.2s\n", "[t] latency=0.3s\n"] * 30
    log.write_text("".join(lines))
    blk = alerts.Alerts(files=str(log), interval=0.0, latency_threshold_ms=100.0, jitter_threshold_ms=0.0, log_to_file=True, log_dir=tmp_path)
    monkeypatch.setattr(alerts.time, "time", lambda: 10.0)
    monkeypatch.setattr(alerts.time, "strftime", lambda fmt: "2025-01-01 00:00:00")
    blk.work([], [])
    out_log = tmp_path / "alerts.txt"
    assert out_log.exists()


def test_check_ping_file_handles_missing():
    blk = alerts.Alerts(files="/tmp/does-not-exist", interval=0.0, log_to_file=False)
    assert blk._check_ping_file("/tmp/does-not-exist") == []


def test_alerts_start_stop(monkeypatch):
    blk = alerts.Alerts(files="/tmp/does-not-exist", interval=0.0, log_to_file=False)
    monkeypatch.setattr(blk, "_run_loop", lambda: blk._stop_evt.set())
    class DummyThread:
        def __init__(self, target, daemon):
            self._target = target
        def start(self):
            self._target()
        def join(self, timeout=None):
            return None

    monkeypatch.setattr(alerts.threading, "Thread", DummyThread)
    blk.start()
    blk.stop()

import types
import netmon.openflow_session as ofs


def test_openflow_session_work(tmp_path, monkeypatch):
    blk = ofs.OpenFlowSessionMonitor(container_name="s1", interval=0.0, log_to_file=True, log_dir=tmp_path)
    monkeypatch.setattr(blk, "_gather", lambda: "session data")
    monkeypatch.setattr(ofs, "now_ts", lambda: (1.0, "2025-01-01"))
    monkeypatch.setattr(ofs.time, "time", lambda: 10.0)
    monkeypatch.setattr(ofs.time, "strftime", lambda fmt: "2025-01-01 00:00:00")
    payloads = []
    monkeypatch.setattr(ofs, "emit_json", lambda self, port, payload: payloads.append(payload))
    blk.work([], [])
    assert payloads and payloads[0]["raw"] == "session data"
    assert (tmp_path / "openflow_session_s1.txt").exists()


def test_openflow_session_run_loop_once(monkeypatch):
    blk = ofs.OpenFlowSessionMonitor(interval=0.0)
    monkeypatch.setattr(blk, "work", lambda *_: None)

    class OneShot:
        def __init__(self):
            self.state = 0

        def is_set(self):
            return self.state > 0

        def set(self):
            self.state = 1

        def wait(self, _):
            self.state = 1

    blk._stop_evt = OneShot()
    blk._run_loop()
    assert blk._stop_evt.state == 1


def test_openflow_session_start_stop(monkeypatch):
    blk = ofs.OpenFlowSessionMonitor(interval=0.0)
    monkeypatch.setattr(blk, "_run_loop", lambda: blk._stop_evt.set())
    monkeypatch.setattr(ofs.threading, "Thread", lambda target, daemon: types.SimpleNamespace(start=target, join=lambda timeout=None: None))
    blk.start()
    blk.stop()

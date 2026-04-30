import types
import netmon.ip_header_capture as ihc


def test_ip_header_capture_work(tmp_path, monkeypatch):
    blk = ihc.IPHeaderCapture(container_name="h1", interface="eth0", count=1, interval=0.0, filter="ip", log_to_file=True, log_dir=tmp_path)
    monkeypatch.setattr(blk, "_run", lambda *cmd: "IP pkt line")
    monkeypatch.setattr(ihc.time, "time", lambda: 10.0)
    monkeypatch.setattr(ihc.time, "strftime", lambda fmt: "2025-01-01 00:00:00")
    blk.work([], [])
    assert (tmp_path / "ip_header_capture_h1.txt").exists()


def test_ip_header_capture_run_loop_once(monkeypatch):
    blk = ihc.IPHeaderCapture(interval=0.0)
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


def test_ip_header_capture_start_stop(monkeypatch):
    blk = ihc.IPHeaderCapture(interval=0.0)
    monkeypatch.setattr(blk, "_run_loop", lambda: blk._stop_evt.set())
    monkeypatch.setattr(ihc.threading, "Thread", lambda target, daemon: types.SimpleNamespace(start=target, join=lambda timeout=None: None))
    blk.start()
    blk.stop()

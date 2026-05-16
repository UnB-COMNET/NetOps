import types
import netmon.exporter as exp


def test_pcap_exporter_work(monkeypatch):
    blk = exp.PCAPExporter(container_name="h1", interface="eth0", duration=1, interval=0.0)
    monkeypatch.setattr(exp.time, "time", lambda: 10.0)
    monkeypatch.setattr(blk, "_run", lambda *cmd: "ok")
    blk.work([], [])


def test_pcap_exporter_run_loop_once(monkeypatch):
    blk = exp.PCAPExporter(interval=0.0)
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


def test_pcap_exporter_start_stop(monkeypatch):
    blk = exp.PCAPExporter(interval=0.0)
    monkeypatch.setattr(blk, "_run_loop", lambda: blk._stop_evt.set())
    monkeypatch.setattr(exp.threading, "Thread", lambda target, daemon: types.SimpleNamespace(start=target, join=lambda timeout=None: None))
    blk.start()
    blk.stop()

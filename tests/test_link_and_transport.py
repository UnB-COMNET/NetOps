import types
import netmon.link_interface_stats as lis
import netmon.transport_stats as ts
from conftest import DummyArray


def test_link_interface_stats_work_logs(tmp_path, monkeypatch):
    monkeypatch.setattr(lis, "time", types.SimpleNamespace(time=lambda: 10.0, strftime=lambda fmt: "2025-01-01 00:00:00"))
    blk = lis.LinkInterfaceStats(container_name="c1", interval=0, log_to_file=True, log_dir=tmp_path)
    monkeypatch.setattr(blk, "_run", lambda *a, **k: "ip -s link output")
    monkeypatch.setattr(blk, "_list_ifaces", lambda: ["eth0"])
    monkeypatch.setattr(blk, "_cat", lambda path: 1)
    blk.work([], [])
    log_path = tmp_path / "link_interface_stats_c1.txt"
    assert log_path.exists()


def test_link_interface_stats_run_loop_once(monkeypatch):
    blk = lis.LinkInterfaceStats(container_name="c1", interval=0, log_to_file=False, log_dir=None)
    called = {}
    blk.work = lambda *_: called.setdefault("count", 0) or called.__setitem__("count", called.get("count", 0) + 1)

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
    assert called.get("count", 0) == 1


def test_link_interface_stats_start_stop(monkeypatch):
    blk = lis.LinkInterfaceStats(container_name="c1", interval=0.0, log_to_file=False, log_dir=None)
    monkeypatch.setattr(blk, "_run_loop", lambda: blk._stop_evt.set())
    monkeypatch.setattr(lis.threading, "Thread", lambda target, daemon: types.SimpleNamespace(start=target, join=lambda timeout=None: None))
    blk.start()
    blk.stop()


def test_transport_stats_work(tmp_path, monkeypatch):
    monkeypatch.setattr(ts, "time", types.SimpleNamespace(time=lambda: 10.0, strftime=lambda fmt: "2025-01-01 00:00:00"))
    blk = ts.TransportStats(container_name="h1", interval=0, log_to_file=True, log_dir=tmp_path)
    monkeypatch.setattr(blk, "_run", lambda *cmd: "Tcp:\nInSegs 1\nTcp:\nInSegs 2\nUdp:\nInDatagrams 1\nUdp:\nInDatagrams 2")
    blk.work([], [])
    assert (tmp_path / "transport_stats_h1.txt").exists()


def test_transport_stats_parse_snmp(monkeypatch):
    blk = ts.TransportStats(container_name="h1", interval=0, log_to_file=False, log_dir=None)
    sample = "Tcp: a b\nTcp: 1 2"
    out = blk._parse_snmp(sample, "Tcp")
    assert out == {"a": 1, "b": 2}


def test_transport_stats_run_loop_once(monkeypatch):
    blk = ts.TransportStats(container_name="h1", interval=0, log_to_file=False, log_dir=None)
    blk.work = lambda *_: None

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


def test_transport_stats_start_stop(monkeypatch):
    blk = ts.TransportStats(container_name="h1", interval=0.0, log_to_file=False, log_dir=None)
    monkeypatch.setattr(blk, "_run_loop", lambda: blk._stop_evt.set())
    monkeypatch.setattr(ts.threading, "Thread", lambda target, daemon: types.SimpleNamespace(start=target, join=lambda timeout=None: None))
    blk.start()
    blk.stop()

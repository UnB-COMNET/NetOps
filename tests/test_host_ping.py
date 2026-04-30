import time
import types

import netmon.host_ping as hp
from conftest import DummyArray


def test_parse_ping_once_time_and_rtt():
    assert hp._parse_ping_once("64 bytes time=1.5 ms") == 0.0015
    rtt_line = "rtt min/avg/max/mdev = 0.1/2.2/3.3/0.0 ms"
    assert hp._parse_ping_once(rtt_line) == 0.0022
    assert hp._parse_ping_once("no match") == -1.0


def test_run_handles_timeout(monkeypatch):
    class Timeout(Exception):
        pass

    def boom(*args, **kwargs):
        raise hp.subprocess.TimeoutExpired(cmd="ping", timeout=1)

    monkeypatch.setattr(hp.subprocess, "run", boom)
    out, err = hp._run(["ping"], timeout=1)
    assert err == "timeout"


def test_host_ping_msg_emits(monkeypatch):
    monkeypatch.setattr(hp, "_run", lambda cmd, timeout=1: ("time=10 ms", ""))
    now = [0.0]
    monkeypatch.setattr(hp.time, "time", lambda: 1700000000.0)
    monkeypatch.setattr(hp.time, "strftime", lambda fmt, ts=None: "2025-01-01 00:00:00")
    monkeypatch.setattr(hp.time, "localtime", lambda t: t)
    msgs = []

    class DummyBlock(hp.gr.basic_block):
        def message_port_pub(self, port, payload):
            msgs.append((port, payload))

    blk = hp.HostPingMsg(container_name="h1", target_ip="1.1.1.1", timeout=1.0)
    blk.message_port_pub = lambda port, payload: msgs.append((port, payload))
    blk._on_tick(None)
    ports = [p for p, _ in msgs]
    assert "out" in ports


def test_host_ping_auto_work_and_stop(tmp_path, monkeypatch):
    monkeypatch.setattr(hp, "_run", lambda cmd, timeout=1: ("time=5 ms", ""))
    monkeypatch.setattr(hp.time, "time", lambda: 10.0)
    out_arr = DummyArray(3)
    blk = hp.HostPingAuto(container_name="h1", target_ip="1.1.1.1", interval=0, timeout=1.0, log_to_file=True, log_dir=tmp_path)
    produced = blk.work([], [out_arr])
    assert produced == len(out_arr)
    assert all(v == 0.005 for v in out_arr)
    blk.stop()


def test_host_ping_auto_idle(monkeypatch):
    monkeypatch.setattr(hp.time, "time", lambda: 1.0)
    out_arr = DummyArray(2)
    blk = hp.HostPingAuto(container_name="h1", target_ip="1.1.1.1", interval=10.0, timeout=1.0, log_to_file=False, log_dir=None)
    blk._last = 1.0
    produced = blk.work([], [out_arr])
    assert produced == len(out_arr)
    assert out_arr == [0.0, 0.0]

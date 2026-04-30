import types
import netmon.forwarding_table_s1 as ft


def test_parse_flows_and_format():
    raw = "priority=10,n_packets=5,n_bytes=100,actions=output:1\ninvalid line"
    flows = ft.ForwardingTableS1()._parse_flows(raw)
    assert flows == [("10", 5, 100, "output:1")]
    out = ft.ForwardingTableS1()._format_output("br0", flows)
    assert "bridge=br0" in out


def test_do_update_emits_and_logs(tmp_path, monkeypatch):
    raw = "priority=1,n_packets=10,n_bytes=20,actions=output:1"
    blk = ft.ForwardingTableS1(container_name="s1", update_interval=0.0, log_to_file=True, log_dir=tmp_path)
    monkeypatch.setattr(blk, "_get_forwarding_table_raw", lambda: ("br0", raw))
    monkeypatch.setattr(ft, "now_ts", lambda: (1.0, "2025-01-01"))
    payloads = []
    monkeypatch.setattr(ft, "emit_json", lambda self, port, payload: payloads.append(payload))
    monkeypatch.setattr(ft.time, "time", lambda: 10.0)
    monkeypatch.setattr(ft.time, "strftime", lambda fmt: "2025-01-01 00:00:00")
    blk._do_update()
    assert payloads and payloads[0]["bridge"] == "br0"
    assert (tmp_path / "forwarding_table_s1.txt").exists()


def test_run_loop_once(monkeypatch):
    blk = ft.ForwardingTableS1(update_interval=0.0)
    monkeypatch.setattr(blk, "_do_update", lambda: None)

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


def test_forwarding_table_start_stop(monkeypatch):
    blk = ft.ForwardingTableS1(update_interval=0.0)
    monkeypatch.setattr(blk, "_run_loop", lambda: blk._stop_evt.set())
    monkeypatch.setattr(ft.threading, "Thread", lambda target, daemon: types.SimpleNamespace(start=target, join=lambda timeout=None: None))
    blk.start()
    blk.stop()

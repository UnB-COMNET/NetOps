import netmon.docker_stats as ds


def test_docker_stats_filters_and_emits(monkeypatch):
    blk = ds.DockerStats(containers="a", interval=0.0, log_to_file=True)
    monkeypatch.setattr(ds, "now_ts", lambda: (1.0, "2025-01-01"))
    ds.DockerStats.work.__globals__["time"] = type("T", (), {"time": staticmethod(lambda: 10.0)})()
    monkeypatch.setattr(ds, "emit_json", lambda self, port, payload: setattr(self, "_payload", payload))
    sample = '{"Name":"a","CPUPerc":"1%","MemUsage":"1MiB / 1GiB","MemPerc":"1%","NetIO":"0B / 0B","BlockIO":"0B / 0B"}\n{"Name":"b","CPUPerc":"2%","MemUsage":"2MiB / 1GiB","MemPerc":"2%","NetIO":"0B / 0B","BlockIO":"0B / 0B"}'
    monkeypatch.setattr(blk, "_gather", lambda: sample.splitlines())
    blk.work([], [])
    assert blk._payload["containers"] and blk._payload["containers"][0]["Name"] == "a"

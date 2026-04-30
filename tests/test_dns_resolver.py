import types

import netmon.dns_resolver as dr
from conftest import DummyArray


def test_dns_resolver_success(monkeypatch):
    times = [10.0, 10.01]

    def fake_time():
        return times.pop(0) if times else 10.02

    monkeypatch.setattr(dr.time, "time", fake_time)
    monkeypatch.setattr(dr.time, "sleep", lambda s: None)
    out_arr = DummyArray(2)

    class Resolver:
        def __init__(self):
            self.nameservers = []

        def resolve(self, name):
            return [name]

    monkeypatch.setattr(dr.dns, "resolver", types.SimpleNamespace(Resolver=Resolver))
    blk = dr.DNSResolverMonitorBlock(dns_server="1.1.1.1", query_name="example.com", interval=0.0)
    blk.work([], [out_arr])
    assert all(v > 0 for v in out_arr)


def test_dns_resolver_error(monkeypatch):
    monkeypatch.setattr(dr.time, "time", lambda: 10.0)
    out_arr = DummyArray(1)

    class Resolver:
        def __init__(self):
            self.nameservers = []

        def resolve(self, name):
            raise RuntimeError("boom")

    monkeypatch.setattr(dr.dns, "resolver", types.SimpleNamespace(Resolver=Resolver))
    blk = dr.DNSResolverMonitorBlock(dns_server="1.1.1.1", query_name="example.com", interval=0.0)
    blk.work([], [out_arr])
    assert out_arr[0] == -1.0

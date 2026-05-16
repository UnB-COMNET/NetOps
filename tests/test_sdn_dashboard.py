import sys
import types
import pytest
from pathlib import Path

# Stub dependencies before importing module
class DummySeries:
    def __init__(self, data):
        self.data = data

    @property
    def str(self):
        return self

    def contains(self, pattern, case=True):
        needle = pattern if case else pattern.lower()
        out = []
        for v in self.data:
            text = str(v)
            text_cmp = text if case else text.lower()
            out.append(needle.lower() in text_cmp if not case else needle in text_cmp)
        return out


class DummyDataFrame:
    def __init__(self, records=None, columns=None):
        self.records = records or []
        self.columns = columns or (list(records[0].keys()) if records else [])

    @property
    def empty(self):
        return len(self.records) == 0

    def __getitem__(self, key):
        if isinstance(key, str):
            return DummySeries([r.get(key) for r in self.records])
        if isinstance(key, list):
            filtered = [r for r, keep in zip(self.records, key) if keep]
            return DummyDataFrame(filtered, columns=self.columns)
        return None

    def to_dict(self, orient):
        if orient == "records":
            return self.records
        return {}


class DummyPandas(types.SimpleNamespace):
    def read_csv(self, path):
        return DummyDataFrame([])

    def DataFrame(self, records=None, columns=None):
        return DummyDataFrame(records=records, columns=columns)

pd_stub = DummyPandas()

class DummyDash:
    def __init__(self, *a, **k):
        self.title = ""
        self.callback_map = {}

    def callback(self, *a, **k):
        def decorator(fn):
            return fn
        return decorator


def _simple(tag):
    return lambda *a, **k: (tag, a, k)

dcc = types.SimpleNamespace(Tabs=_simple("tabs"), Tab=_simple("tab"), Interval=_simple("interval"), Graph=_simple("graph"))
html = types.SimpleNamespace(H1=_simple("h1"), Div=_simple("div"))
dash_table = types.SimpleNamespace(DataTable=_simple("table"))

dep = types.SimpleNamespace(Input=lambda *a, **k: ("Input", a, k), Output=lambda *a, **k: ("Output", a, k))
px = types.SimpleNamespace(line=lambda *a, **k: {"line": k}, bar=lambda *a, **k: {"bar": k})
dmod = types.SimpleNamespace(Dash=DummyDash, dcc=dcc, html=html, dash_table=dash_table, dependencies=dep)
sys.modules.setdefault("dash", dmod)
sys.modules.setdefault("dash.dcc", dcc)
sys.modules.setdefault("dash.html", html)
sys.modules.setdefault("dash_table", dash_table)
sys.modules.setdefault("dash.dependencies", dep)
sys.modules.setdefault("plotly", types.SimpleNamespace(express=px))
sys.modules.setdefault("plotly.express", px)
sys.modules.setdefault("pandas", pd_stub)

import sdn_dashboard as dashmod


def test_load_data_empty(tmp_path, monkeypatch):
    # CSV missing -> empty dataframe
    monkeypatch.setattr(dashmod, "CSV_PATH", str(tmp_path / "missing.csv"))
    df = dashmod.load_data()
    assert df.empty


def test_update_tab_variants(monkeypatch):
    data = DummyDataFrame(records=[
        {"timestamp": "t1", "node": "h1", "layer": "d", "metric": "icmp_avg_ms", "value": 1.0, "details_json": "{}"},
        {"timestamp": "t1", "node": "h1", "layer": "d", "metric": "throughput_sent_Mbps", "value": 2.0, "details_json": "{}"},
        {"timestamp": "t1", "node": "h1", "layer": "d", "metric": "packet_counts_total", "value": 3.0, "details_json": "{}"},
        {"timestamp": "t1", "node": "system", "layer": "host", "metric": "cpu", "value": 4.0, "details_json": "{}"},
    ])
    monkeypatch.setattr(dashmod, "load_data", lambda: data)
    for tab in ["latency", "throughput", "capture", "system", "table", "other"]:
        out = dashmod.update_tab(tab, 0)
        assert out is not None

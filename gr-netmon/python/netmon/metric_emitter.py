import json
import random
import time
from typing import Any, Dict

import numpy as np
import pmt
from gnuradio import gr

from .metrics import now_ts, emit_json


def _parse_json(value: Any) -> Dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _msg_to_dict(msg: Any) -> Dict[str, Any]:
    try:
        data = pmt.to_python(msg)
    except Exception:
        data = None
    if isinstance(data, dict):
        return data
    if isinstance(data, (str, bytes)):
        try:
            parsed = json.loads(data.decode() if isinstance(data, bytes) else data)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


class MetricEmitterAuto(gr.sync_block):
    """Auto/stream metric emitter with optional tick message trigger."""

    def __init__(
        self,
        metric_name: str,
        layer: str = "network",
        unit: str = "",
        node: str = "node",
        value: float = 0.0,
        interval: float = 1.0,
        jitter: float = 0.0,
        labels_json: str = "{}",
        details_json: str = "{}",
    ) -> None:
        gr.sync_block.__init__(self, name=f"MetricEmitterAuto:{metric_name}", in_sig=[], out_sig=[np.float32])
        self.metric_name = metric_name
        self.layer = layer
        self.unit = unit
        self.node = node
        self.value = float(value)
        self.interval = float(interval)
        self.jitter = float(jitter)
        self.labels = _parse_json(labels_json)
        self.details = _parse_json(details_json)
        self._last_emit = 0.0
        self._force_emit = False

        self.message_port_register_in(pmt.intern("tick"))
        self.message_port_register_out(pmt.intern("metrics"))
        self.set_msg_handler(pmt.intern("tick"), self._on_tick)

    def _on_tick(self, msg: Any) -> None:
        data = _msg_to_dict(msg)
        if "value" in data:
            try:
                self.value = float(data["value"])
            except Exception:
                pass
        if "node" in data:
            self.node = str(data["node"])
        if "labels" in data and isinstance(data["labels"], dict):
            self.labels.update(data["labels"])
        if "details" in data and isinstance(data["details"], dict):
            self.details.update(data["details"])
        self._force_emit = True

    def _emit(self, value: float) -> None:
        t_epoch, t_iso = now_ts()
        payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "metric_emitter",
            "metric": self.metric_name,
            "layer": self.layer,
            "unit": self.unit,
            "node": self.node,
            "value": float(value),
            "labels": dict(self.labels),
            "details": dict(self.details),
            "mode": "auto",
        }
        emit_json(self, "metrics", payload)

    def work(self, input_items, output_items):
        out = output_items[0]
        now = time.time()
        should_emit = self._force_emit or (now - self._last_emit >= self.interval)
        if should_emit:
            jitter = random.uniform(-self.jitter, self.jitter) if self.jitter else 0.0
            value = self.value + jitter
            self._emit(value)
            self._last_emit = now
            self._force_emit = False
            out[:] = value
        else:
            out[:] = self.value
        return len(out)


class MetricEmitterMsg(gr.basic_block):
    """Message-driven metric emitter (no stream output)."""

    def __init__(
        self,
        metric_name: str,
        layer: str = "network",
        unit: str = "",
        node: str = "node",
        value: float = 0.0,
        labels_json: str = "{}",
        details_json: str = "{}",
    ) -> None:
        gr.basic_block.__init__(self, name=f"MetricEmitterMsg:{metric_name}", in_sig=[], out_sig=[])
        self.metric_name = metric_name
        self.layer = layer
        self.unit = unit
        self.node = node
        self.value = float(value)
        self.labels = _parse_json(labels_json)
        self.details = _parse_json(details_json)

        self.message_port_register_in(pmt.intern("tick"))
        self.message_port_register_out(pmt.intern("metrics"))
        self.set_msg_handler(pmt.intern("tick"), self._on_tick)

    def _on_tick(self, msg: Any) -> None:
        data = _msg_to_dict(msg)
        value = self.value
        if "value" in data:
            try:
                value = float(data["value"])
            except Exception:
                pass
        node = str(data.get("node", self.node))
        labels = dict(self.labels)
        details = dict(self.details)
        if isinstance(data.get("labels"), dict):
            labels.update(data["labels"])
        if isinstance(data.get("details"), dict):
            details.update(data["details"])

        t_epoch, t_iso = now_ts()
        payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "metric_emitter",
            "metric": self.metric_name,
            "layer": self.layer,
            "unit": self.unit,
            "node": node,
            "value": float(value),
            "labels": labels,
            "details": details,
            "mode": "msg",
        }
        emit_json(self, "metrics", payload)

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict

from platform.backend.core.registry import registry
from platform.backend.core.plugins import MetricCollector


class CsvCollector:
    def __init__(self, path: str = "raw/metrics.csv") -> None:
        self._name = "csv"
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def name(self) -> str:
        return self._name

    def supported_metrics(self) -> list[str]:
        return ["latency_ms", "packet_loss_pct", "throughput_mbps"]

    async def start(self, context: Dict[str, Any]) -> None:
        # Ensure file exists with header if needed
        if not self._path.exists():
            self._path.write_text("timestamp,metric,value,labels\n", encoding="utf-8")
        await asyncio.sleep(0)

    async def collect(self, context: Dict[str, Any]) -> Dict[str, Any]:
        # Example: append a dummy row; real impl would use context data
        row = context.get("row")
        if row:
            with self._path.open("a", encoding="utf-8") as f:
                f.write(row + "\n")
        return {"written": bool(row)}

    async def stop(self, context: Dict[str, Any]) -> None:
        await asyncio.sleep(0)


collector = CsvCollector()
registry.register_metric_collector(collector)

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Iterable, Sequence

from platform.backend.schemas import MetricSample


class TimeseriesSink:
    """Simple JSONL sink that emulates a TSDB write path with retention."""

    def __init__(self, base_path: str = "raw/metrics_timeseries", retention_files: int = 30) -> None:
        self._base = Path(base_path)
        self._retention = max(1, retention_files)
        self._base.parent.mkdir(parents=True, exist_ok=True)

    def _file_for_today(self) -> Path:
        today = datetime.utcnow().strftime("%Y%m%d")
        return self._base.with_name(f"{self._base.name}_{today}.jsonl")

    def _enforce_retention(self) -> None:
        files = sorted(self._base.parent.glob(f"{self._base.name}_*.jsonl"))
        if len(files) <= self._retention:
            return
        for old in files[:-self._retention]:
            try:
                old.unlink()
            except OSError:
                # Retention cleanup should not block writes.
                continue

    def write_samples(self, samples: Sequence[MetricSample]) -> int:
        if not samples:
            return 0
        path = self._file_for_today()
        with path.open("a", encoding="utf-8") as f:
            for sample in samples:
                payload = {
                    "timestamp": sample.timestamp.isoformat(),
                    "node": sample.node,
                    "layer": sample.layer,
                    "metric": sample.metric,
                    "value": sample.value,
                    "details": sample.details,
                    "labels": sample.labels,
                }
                f.write(json.dumps(payload) + "\n")
        self._enforce_retention()
        return len(samples)

    def latest(self, limit: int = 100) -> Iterable[dict]:
        files = sorted(self._base.parent.glob(f"{self._base.name}_*.jsonl"), reverse=True)
        yielded = 0
        for path in files:
            with path.open(encoding="utf-8") as f:
                for line in reversed(list(f)):
                    if yielded >= limit:
                        return
                    try:
                        yield json.loads(line)
                        yielded += 1
                    except json.JSONDecodeError:
                        continue

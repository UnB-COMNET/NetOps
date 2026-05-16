import subprocess
from gnuradio import gr
import pmt
from .metrics import now_ts, emit_json


class DockerStats(gr.sync_block):
    """
    Polls `docker stats --no-stream` on the host and emits JSON with per-container
    CPU %, memory usage, and I/O metrics. Intended as a lightweight resource monitor
    complementing network metrics.

    Parameters:
    - containers: comma-separated list of container names to include; empty = all
    - interval: seconds between polls
    - log_to_file: if True, prints to console (no file write here to keep scope minimal)
    """

    def __init__(self, containers="", interval=3.0, log_to_file=False):
        gr.sync_block.__init__(self, name="Docker Stats", in_sig=None, out_sig=None)
        self._names = [x.strip() for x in containers.split(",") if x.strip()]
        self.interval = float(interval)
        self.log_to_file = bool(log_to_file)
        self._last = 0.0
        self.message_port_register_out(pmt.intern("metrics"))

    def _run(self, *cmd):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
            return r.stdout
        except Exception:
            return ""

    def _gather(self):
        # Use json format for reliable parsing; one JSON per line
        fmt = "{{\"Name\":\"{{.Name}}\",\"CPUPerc\":\"{{.CPUPerc}}\",\"MemUsage\":\"{{.MemUsage}}\",\"MemPerc\":\"{{.MemPerc}}\",\"NetIO\":\"{{.NetIO}}\",\"BlockIO\":\"{{.BlockIO}}\"}}"
        out = self._run("docker", "stats", "--no-stream", "--format", fmt)
        lines = [l for l in out.splitlines() if l.strip()]
        return lines

    def start(self):
        return True

    def work(self, input_items, output_items):
        import json
        import time

        now = time.time()
        if now - self._last < self.interval:
            return 0
        self._last = now

        lines = self._gather()
        t_epoch, t_iso = now_ts()
        items = []
        for l in lines:
            try:
                item = json.loads(l)
                if self._names and item.get("Name") not in self._names:
                    continue
                items.append(item)
            except Exception:
                continue

        payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "docker_stats",
            "containers": items,
        }
        emit_json(self, "metrics", payload)
        if self.log_to_file:
            print(payload, flush=True)
        return 0

import time
import os
import threading
from gnuradio import gr
from .metrics import resolve_log_dir

class Alerts(gr.sync_block):
    """
    Reads raw log files periodically and emits alerts when thresholds are exceeded.
    Parameters:
    - files: comma-separated list of raw files to monitor
    - interval: seconds between checks
    - latency_threshold_ms: alert if latency exceeds
    - loss_threshold_pct: alert if loss exceeds
    - jitter_threshold_ms: alert if jitter exceeds
    - log_to_file/log_dir: write alerts to file
    """
    def __init__(self, files=None, interval=2.0,
                 latency_threshold_ms=50.0, loss_threshold_pct=10.0, jitter_threshold_ms=20.0,
                 log_to_file=True, log_dir=None):
        gr.sync_block.__init__(self,
            name="Alerts",
            in_sig=None,
            out_sig=None)
        resolved_dir = resolve_log_dir(log_dir)
        default_file = os.path.join(resolved_dir, "host_ping_auto.txt")
        use_files = files or default_file
        self.files = [f.strip() for f in use_files.split(",") if f.strip()]
        self.interval = float(interval)
        self.lat_th = float(latency_threshold_ms)
        self.loss_th = float(loss_threshold_pct)
        self.jit_th = float(jitter_threshold_ms)
        self.log_to_file = bool(log_to_file)
        self.log_dir = resolved_dir
        self._last = 0.0
        self._fp = None
        self._stop_evt = threading.Event()
        self._thread = None

    def _check_ping_file(self, path):
        alerts = []
        try:
            with open(path, "r") as f:
                lines = f.readlines()[-50:]
            latencies = []
            for l in lines:
                if "latency" in l and "=" in l and "s" in l:
                    try:
                        val = float(l.split("=")[-1].replace("s","")) * 1000.0
                        latencies.append(val)
                    except Exception:
                        pass
            if latencies:
                avg = sum(latencies)/len(latencies)
                # simple jitter estimate: mean absolute diff
                diffs = [abs(latencies[i]-latencies[i-1]) for i in range(1, len(latencies))]
                jitter = sum(diffs)/len(diffs) if diffs else 0.0
                if avg > self.lat_th:
                    alerts.append(f"ALERTA: Latência média {avg:.2f}ms > {self.lat_th}ms em {os.path.basename(path)}")
                if jitter > self.jit_th:
                    alerts.append(f"ALERTA: Jitter {jitter:.2f}ms > {self.jit_th}ms em {os.path.basename(path)}")
        except Exception:
            pass
        return alerts

    def stop(self):
        if self._thread is not None:
            self._stop_evt.set()
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._fp:
            try:
                self._fp.close()
            except Exception:
                pass
        return True

    def start(self):
        if self._thread is None:
            self._stop_evt.clear()
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
        return True

    def _run_loop(self):
        while not self._stop_evt.is_set():
            try:
                self.work([], [])
            except Exception as e:
                print(f"[Alerts] loop error: {e}", flush=True)
            self._stop_evt.wait(0.1)

    def work(self, input_items, output_items):
        now = time.time()
        if now - self._last < self.interval:
            return 0
        self._last = now
        alerts = []
        for path in self.files:
            if path.endswith("host_ping_auto.txt"):
                alerts.extend(self._check_ping_file(path))
            # other file types can be added similarly
        if alerts:
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            out = "\n".join(f"[{ts}] {a}" for a in alerts) + "\n"
            print(out, end="", flush=True)
            if self.log_to_file:
                try:
                    if self._fp is None:
                        path = f"{self.log_dir}/alerts.txt"
                        self._fp = open(path, "a", buffering=1)
                    self._fp.write(out)
                except Exception:
                    pass
        return 0

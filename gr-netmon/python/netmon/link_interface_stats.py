import time
import subprocess
import threading
from gnuradio import gr
import pmt
from .metrics import now_ts, emit_json, resolve_log_dir

class LinkInterfaceStats(gr.sync_block):
    """
    Autonomous block that polls per-interface link stats inside a Docker container
    using `ip -s link` and logs to raw file.

    Parameters:
    - container_name: container to query (e.g., h1, h2, s1)
    - interval: seconds between polls
    - log_to_file: write logs
    - log_dir: directory for logs
    """

    def __init__(self, container_name="h1", interval=2.0, log_to_file=True, log_dir=None):
        gr.sync_block.__init__(self,
            name="Link Interface Stats",
            in_sig=None,
            out_sig=None)

        self.container = container_name
        self.interval = float(interval)
        self.log_to_file = bool(log_to_file)
        self.log_dir = resolve_log_dir(log_dir)
        self._last = 0.0
        self._fp = None
        self._stop_evt = threading.Event()
        self._thread = None

        print(f"[LinkInterfaceStats] init container={self.container} interval={self.interval}", flush=True)
        self.message_port_register_out(pmt.intern("metrics"))

    def _run(self, *cmd):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            return (r.stdout + r.stderr)
        except Exception as e:
            return f"ERR: {e}\n"

    def _format(self, text):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        lines = [l for l in text.splitlines() if l.strip()]
        return f"[{ts}] container={self.container} ip -s link\n" + "\n".join(lines) + "\n"

    def _list_ifaces(self):
        try:
            r = subprocess.run(["docker", "exec", self.container, "sh", "-lc", "ls -1 /sys/class/net"], capture_output=True, text=True, timeout=5)
            ifaces = [x.strip() for x in r.stdout.splitlines() if x.strip()]
            return [i for i in ifaces if i != "lo"]
        except Exception:
            return []

    def _cat(self, path):
        try:
            r = subprocess.run(["docker", "exec", self.container, "cat", path], capture_output=True, text=True, timeout=3)
            return int(r.stdout.strip())
        except Exception:
            return 0

    def _gather_sysfs(self):
        metrics = []
        for iface in self._list_ifaces():
            base = f"/sys/class/net/{iface}/statistics"
            entry = {
                "iface": iface,
                "rx_bytes": self._cat(f"{base}/rx_bytes"),
                "rx_packets": self._cat(f"{base}/rx_packets"),
                "rx_errors": self._cat(f"{base}/rx_errors"),
                "tx_bytes": self._cat(f"{base}/tx_bytes"),
                "tx_packets": self._cat(f"{base}/tx_packets"),
                "tx_errors": self._cat(f"{base}/tx_errors"),
            }
            metrics.append(entry)
        return metrics

    def start(self):
        return True

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
                print(f"[LinkInterfaceStats] loop error: {e}", flush=True)
            self._stop_evt.wait(0.1)

    def work(self, input_items, output_items):
        now = time.time()
        if now - self._last < self.interval:
            return 0
        self._last = now
        raw = self._run("docker", "exec", self.container, "ip", "-s", "link")
        out = self._format(raw)
        print(out, end="", flush=True)
        # Emit structured JSON metrics using sysfs counters
        t_epoch, t_iso = now_ts()
        payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "link_interface_stats",
            "container": self.container,
            "ifaces": self._gather_sysfs(),
        }
        emit_json(self, "metrics", payload)
        if self.log_to_file:
            try:
                if self._fp is None:
                    path = f"{self.log_dir}/link_interface_stats_{self.container}.txt"
                    self._fp = open(path, "a", buffering=1)
                self._fp.write(out)
            except Exception as e:
                print(f"[LinkInterfaceStats] file log error: {e}", flush=True)
        return 0

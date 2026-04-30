import time
import subprocess
import threading
from gnuradio import gr
import pmt
from .metrics import now_ts, emit_json, resolve_log_dir

class IPHeaderCapture(gr.sync_block):
    """
    Autonomous block that runs tcpdump inside a container to sample IP headers.

    Parameters:
    - container_name: container to capture in
    - interface: interface to capture (e.g., eth0)
    - count: packets per interval to sample
    - interval: seconds between samples
    - filter: tcpdump filter (e.g., 'ip')
    - log_to_file/log_dir: logging controls
    """
    def __init__(self, container_name="h1", interface="eth0", count=20, interval=5.0, filter="ip", log_to_file=True, log_dir=None):
        gr.sync_block.__init__(self,
            name="IP Header Capture",
            in_sig=None,
            out_sig=None)
        self.container = container_name
        self.interface = interface
        self.count = int(count)
        self.interval = float(interval)
        self.filter = filter
        self.log_to_file = bool(log_to_file)
        self.log_dir = resolve_log_dir(log_dir)
        self._last = -self.interval  # force immediate first capture
        self._fp = None
        self._stop_evt = threading.Event()
        self._thread = None
        self.message_port_register_out(pmt.intern("metrics"))

    def _run(self, *cmd):
        try:
            # Keep tcpdump bounded so Stop/Play responds quickly even if no packets arrive.
            timeout_sec = max(1.0, min(self.interval, 3.0))
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec)
            return (r.stdout + r.stderr)
        except Exception as e:
            return f"ERR: {e}\n"

    def _summarize(self, text):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        lines = []
        for l in text.splitlines():
            l = l.strip()
            if not l:
                continue
            # crude parse: look for src > dst format
            lines.append(l)
        return f"[{ts}] container={self.container} iface={self.interface} tcpdump headers\n" + "\n".join(lines) + "\n"

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
                print(f"[IPHeaderCapture] loop error: {e}", flush=True)
            self._stop_evt.wait(0.1)

    def work(self, input_items, output_items):
        now = time.time()
        if now - self._last < self.interval:
            return 0
        self._last = now
        raw = self._run("docker", "exec", self.container, "tcpdump", "-n", "-l", "-i", self.interface, "-c", str(self.count), self.filter)
        out = self._summarize(raw)
        print(out, end="", flush=True)
        t_epoch, t_iso = now_ts()
        lines = [l for l in raw.splitlines() if l.strip()]
        emit_json(self, "metrics", {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "ip_header_capture",
            "container": self.container,
            "interface": self.interface,
            "filter": self.filter,
            "count": int(self.count),
            "lines": len(lines),
            "ok": not raw.startswith("ERR:"),
        })
        if self.log_to_file:
            try:
                if self._fp is None:
                    path = f"{self.log_dir}/ip_header_capture_{self.container}.txt"
                    self._fp = open(path, "a", buffering=1)
                self._fp.write(out)
            except Exception as e:
                print(f"[IPHeaderCapture] file log error: {e}", flush=True)
        return 0

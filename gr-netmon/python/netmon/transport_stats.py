import time
import subprocess
import threading
from gnuradio import gr
import pmt
from .metrics import now_ts, emit_json, resolve_log_dir

class TransportStats(gr.sync_block):
    """
    Autonomous transport-layer stats using `ss -s` and `/proc/net/snmp` inside container.
    Logs TCP/UDP summary to raw directory.
    """
    def __init__(self, container_name="h1", interval=2.0, log_to_file=True, log_dir=None):
        gr.sync_block.__init__(self,
            name="Transport Stats",
            in_sig=None,
            out_sig=None)
        self.message_port_register_out(pmt.intern("metrics"))
        self.container = container_name
        self.interval = float(interval)
        self.log_to_file = bool(log_to_file)
        self.log_dir = resolve_log_dir(log_dir)
        self._last = 0.0
        self._fp = None
        self._stop_evt = threading.Event()
        self._thread = None

    def _run(self, *cmd):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
            return (r.stdout + r.stderr)
        except Exception as e:
            return f"ERR: {e}\n"

    def _gather(self):
        ss = self._run("docker", "exec", self.container, "ss", "-s")
        snmp = self._run("docker", "exec", self.container, "cat", "/proc/net/snmp")
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        return f"[{ts}] container={self.container}\n== ss -s ==\n{ss}\n== /proc/net/snmp ==\n{snmp}\n", ss, snmp

    def _parse_snmp(self, text, section):
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        headers = None
        values = None
        for i in range(len(lines) - 1):
            if lines[i].startswith(section + ":") and lines[i+1].startswith(section + ":"):
                headers = lines[i].split()[1:]
                values = lines[i+1].split()[1:]
                break
        if headers and values and len(headers) == len(values):
            out = {}
            for k, v in zip(headers, values):
                try:
                    out[k] = int(v)
                except Exception:
                    out[k] = v
            return out
        return {}

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
                print(f"[TransportStats] loop error: {e}", flush=True)
            self._stop_evt.wait(0.1)

    def work(self, input_items, output_items):
        now = time.time()
        if now - self._last < self.interval:
            return 0
        self._last = now
        text, ss, snmp = self._gather()
        print(text, end="", flush=True)
        # Emit structured JSON (Tcp/Udp from /proc/net/snmp)
        tcp = self._parse_snmp(snmp, "Tcp")
        udp = self._parse_snmp(snmp, "Udp")
        t_epoch, t_iso = now_ts()
        payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "transport_stats",
            "container": self.container,
            "snmp": {
                "tcp": tcp,
                "udp": udp,
            },
        }
        emit_json(self, "metrics", payload)
        if self.log_to_file:
            try:
                if self._fp is None:
                    path = f"{self.log_dir}/transport_stats_{self.container}.txt"
                    self._fp = open(path, "a", buffering=1)
                self._fp.write(text)
            except Exception as e:
                print(f"[TransportStats] file log error: {e}", flush=True)
        return 0

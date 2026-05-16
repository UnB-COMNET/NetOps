import time
import subprocess
import threading
from gnuradio import gr
import pmt
from .metrics import now_ts, emit_json, resolve_log_dir

class OpenFlowSessionMonitor(gr.sync_block):
    """
    Autonomous block that checks OpenFlow session status between controller and switch
    using ovs utilities inside the switch container.
    """
    def __init__(self, container_name="s1", interval=5.0, log_to_file=True, log_dir=None):
        gr.sync_block.__init__(self,
            name="OpenFlow Session Monitor",
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
        show = self._run("docker", "exec", self.container, "ovs-ofctl", "show", "s1")
        vsctl = self._run("docker", "exec", self.container, "ovs-vsctl", "show")
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        return f"[{ts}] container={self.container}\n== ovs-ofctl show ==\n{show}\n== ovs-vsctl show ==\n{vsctl}\n"

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
                print(f"[OpenFlowSessionMonitor] loop error: {e}", flush=True)
            self._stop_evt.wait(0.1)

    def work(self, input_items, output_items):
        now = time.time()
        if now - self._last < self.interval:
            return 0
        self._last = now
        out = self._gather()
        print(out, end="", flush=True)
        # Emit structured JSON with raw fields for ease of parsing externally
        t_epoch, t_iso = now_ts()
        payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "openflow_session",
            "container": self.container,
            "raw": out,
        }
        emit_json(self, "metrics", payload)
        if self.log_to_file:
            try:
                if self._fp is None:
                    path = f"{self.log_dir}/openflow_session_{self.container}.txt"
                    self._fp = open(path, "a", buffering=1)
                self._fp.write(out)
            except Exception as e:
                print(f"[OpenFlowSessionMonitor] file log error: {e}", flush=True)
        return 0

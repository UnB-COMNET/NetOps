import time
import subprocess
import threading
from gnuradio import gr

class PCAPExporter(gr.sync_block):
    """
    Runs tcpdump inside a container to export PCAP files with rotation.
    Parameters:
    - container_name, interface, filter
    - pcap_dir: directory inside container to save
    - file_prefix: prefix for PCAP files
    - duration: seconds per capture file
    - interval: seconds between rotations
    """
    def __init__(self, container_name="h1", interface="eth0", filter="ip",
                 pcap_dir="/tmp", file_prefix="capture", duration=10, interval=10):
        gr.sync_block.__init__(self,
            name="PCAP Exporter",
            in_sig=None,
            out_sig=None)
        self.container = container_name
        self.interface = interface
        self.filter = filter
        self.pcap_dir = pcap_dir
        self.file_prefix = file_prefix
        self.duration = int(duration)
        self.interval = float(interval)
        self._last = 0.0
        self._stop_evt = threading.Event()
        self._thread = None

    def _run(self, *cmd):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=self.duration+5)
            return (r.stdout + r.stderr)
        except Exception as e:
            return f"ERR: {e}\n"

    def work(self, input_items, output_items):
        now = time.time()
        if now - self._last < self.interval:
            return 0
        self._last = now
        filename = f"{self.file_prefix}_{int(now)}.pcap"
        cmd = ["docker", "exec", self.container, "timeout", str(self.duration),
               "tcpdump", "-i", self.interface, "-w", f"{self.pcap_dir}/{filename}"]
        if self.filter:
            cmd.append(self.filter)
        out = self._run(*cmd)
        print(out, end="", flush=True)
        return 0

    def start(self):
        if self._thread is None:
            self._stop_evt.clear()
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
        return True

    def stop(self):
        if self._thread is not None:
            self._stop_evt.set()
            self._thread.join(timeout=self.interval + 5)
            self._thread = None
        return True

    def _run_loop(self):
        while not self._stop_evt.is_set():
            try:
                self.work([], [])
            except Exception as e:
                print(f"[PCAPExporter] loop error: {e}", flush=True)
            self._stop_evt.wait(0.1)

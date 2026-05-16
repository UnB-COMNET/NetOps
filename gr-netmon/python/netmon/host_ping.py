import subprocess
import time
from gnuradio import gr
import pmt
import numpy as np
from .metrics import now_ts, emit_json, resolve_log_dir

def _run(cmd, timeout=5):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.stderr.strip()
    except subprocess.TimeoutExpired:
        return "", "timeout"
    except Exception as e:
        return "", str(e)

def _parse_ping_once(out):
    # Expect something like: '64 bytes from ... time=0.123 ms' or 'rtt min/avg/max/mdev = ...'
    if "time=" in out:
        try:
            # find last occurrence
            pos = out.rfind("time=")
            ms_part = out[pos+5:]
            ms_val = ms_part.split()[0]  # up to space
            if ms_val.endswith("ms"):
                ms_val = ms_val[:-2]
            return float(ms_val) / 1000.0
        except Exception:
            pass
    # Try rtt summary
    if "rtt min/avg/max/mdev" in out:
        try:
            seg = out.split("=")[-1].strip()
            avg_ms = seg.split("/")[1]
            return float(avg_ms) / 1000.0
        except Exception:
            pass
    return -1.0

class HostPingMsg(gr.basic_block):
    """Message-driven ping inside a Docker container

    Params:
      container_name: e.g., 'h1'
      target_ip: e.g., '172.18.0.3'
      timeout: seconds for ping -W
    Ports:
      tick (in msg) -> triggers one ping
      out (out msg) -> formatted result string
    """
    def __init__(self, container_name="h1", target_ip="172.18.0.3", timeout=2.0):
        gr.basic_block.__init__(self, name="HostPingMsg", in_sig=[], out_sig=[])
        self.container = container_name
        self.target_ip = target_ip
        self.timeout = float(timeout)
        self.message_port_register_in(pmt.intern("tick"))
        self.message_port_register_out(pmt.intern("out"))
        self.message_port_register_out(pmt.intern("metrics"))
        self.set_msg_handler(pmt.intern("tick"), self._on_tick)

    def _on_tick(self, msg):
        cmd = ["docker", "exec", self.container, "ping", "-c", "1", "-W", str(int(self.timeout)), self.target_ip]
        out, err = _run(cmd, timeout=int(self.timeout)+2)
        latency = _parse_ping_once(out)
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        text = f"[{ts}] {self.container} -> {self.target_ip} latency={latency:.6f}s"
        print(text, flush=True)
        self.message_port_pub(pmt.intern("out"), pmt.to_pmt(text))
        t_epoch, t_iso = now_ts()
        payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "host_ping",
            "mode": "msg",
            "container": self.container,
            "target_ip": self.target_ip,
            "latency_s": float(latency),
            "ok": bool(latency >= 0.0),
        }
        emit_json(self, "metrics", payload)

class HostPingAuto(gr.sync_block):
    """Autonomous ping loop emitting a float stream of latency (seconds).

    Emits 0.0 when idle, -1.0 on error.
    Also prints formatted line to console.
    """
    def __init__(self, container_name="h1", target_ip="172.18.0.3", interval=1.0, timeout=2.0, log_to_file=False, log_dir=None):
        gr.sync_block.__init__(self, name="HostPingAuto", in_sig=[], out_sig=[np.float32])
        self.container = container_name
        self.target_ip = target_ip
        self.interval = float(interval)
        self.timeout = float(timeout)
        self._last = 0.0
        self.log_to_file = bool(log_to_file)
        self.log_dir = resolve_log_dir(log_dir)
        self._log_fp = None
        # metrics message output
        self.message_port_register_out(pmt.intern("metrics"))

    def work(self, input_items, output_items):
        out = output_items[0]
        now = time.time()
        if now - self._last >= self.interval:
            cmd = ["docker", "exec", self.container, "ping", "-c", "1", "-W", str(int(self.timeout)), self.target_ip]
            s, e = _run(cmd, timeout=int(self.timeout)+2)
            latency = _parse_ping_once(s)
            ts = time.strftime("%Y-%m-%d %H:%M:%S")
            line = f"[{ts}] {self.container} -> {self.target_ip} latency={latency:.6f}s\n"
            print(line, end="", flush=True)
            if self.log_to_file:
                try:
                    if self._log_fp is None:
                        path = f"{self.log_dir}/host_ping_auto.txt"
                        self._log_fp = open(path, "a", buffering=1)
                    self._log_fp.write(line)
                except Exception:
                    pass
            # emit JSON metrics sample
            t_epoch, t_iso = now_ts()
            payload = {
                "ts": t_epoch,
                "ts_iso": t_iso,
                "module": "host_ping",
                "mode": "auto",
                "container": self.container,
                "target_ip": self.target_ip,
                "latency_s": float(latency),
                "ok": bool(latency >= 0.0),
            }
            emit_json(self, "metrics", payload)
            val = latency
            self._last = now
        else:
            val = 0.0
        out[:] = val
        return len(out)

    def stop(self):
        try:
            if self._log_fp is not None:
                self._log_fp.close()
        except Exception:
            pass
        return True
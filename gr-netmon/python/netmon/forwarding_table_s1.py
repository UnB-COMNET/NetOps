import time
import subprocess
from gnuradio import gr
import pmt
import threading
from .metrics import now_ts, emit_json, resolve_log_dir

class ForwardingTableS1(gr.basic_block):
    """
    GNU Radio Python message block that queries Open vSwitch flows inside a Docker
    container (default 's1') and publishes a formatted forwarding table snapshot.

    Parameters:
    - container_name (str): Docker container name running OVS.
    - update_interval (float): Minimum seconds between queries.
    - colorize (bool): Placeholder for future terminal colorization.

    Ports:
    - input message 'tick': triggers an update attempt.
    - output message 'out': formatted text output for GUI.
    """
    def __init__(self, container_name="s1", update_interval=5.0, colorize=False, auto_start=True, bridge_override=None, log_to_file=False, log_dir=None):
        gr.basic_block.__init__(
            self,
            name="ForwardingTableS1",
            in_sig=[],
            out_sig=[]
        )

        self.container_s1 = container_name
        self.update_interval = float(update_interval)
        self.colorize = bool(colorize)
        self.auto_start = bool(auto_start)
        self.bridge_override = bridge_override
        self.last_update = 0
        self.last_stats = {}  # {priority: (packets, bytes)}
        self._stop_evt = threading.Event()
        self._thread = None
        self.log_to_file = bool(log_to_file)
        self.log_dir = resolve_log_dir(log_dir)
        self._log_fp = None

        print(f"[ForwardingTableS1] init container={self.container_s1} interval={self.update_interval} bridge_override={self.bridge_override}", flush=True)

        # Message ports
        self.message_port_register_in(pmt.intern("tick"))
        self.message_port_register_out(pmt.intern("out"))
        self.message_port_register_out(pmt.intern("metrics"))
        self.set_msg_handler(pmt.intern("tick"), self._on_tick)

    # ---------- Discovery/exec ----------
    def _detect_bridge_name(self):
        try:
            result = subprocess.run(
                ["docker", "exec", self.container_s1, "ovs-vsctl", "list-br"],
                capture_output=True, text=True, timeout=5
            )
            bridges = [b.strip() for b in result.stdout.splitlines() if b.strip()]
            return bridges[0] if bridges else None
        except Exception:
            return None

    def _run(self, *cmd, timeout=5):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            return (result.stdout + result.stderr).strip()
        except subprocess.TimeoutExpired:
            return "Timeout ao executar: " + " ".join(cmd)
        except Exception as e:
            return f"Erro ao executar {' '.join(cmd)}: {e}"

    def _get_forwarding_table_raw(self):
        bridge_name = self.bridge_override or self._detect_bridge_name()
        if not bridge_name:
            return None, "Nenhum bridge encontrado no container."
        output = self._run("docker", "exec", self.container_s1,
                           "ovs-ofctl", "dump-flows", bridge_name)
        return bridge_name, output

    # ---------- Parsing ----------
    def _extract_field(self, line, key):
        for part in line.split():
            if part.startswith(key + "="):
                val = part.split("=", 1)[1]
                return val.rstrip(",")
        return None

    def _parse_flows(self, raw):
        lines = raw.splitlines()
        flows = []
        for line in lines:
            if "priority=" in line and "actions=" in line:
                clean = line.replace(",", " ")
                prio = self._extract_field(clean, "priority")
                pkts = self._extract_field(clean, "n_packets")
                byts = self._extract_field(clean, "n_bytes")
                acts = self._extract_field(clean, "actions")
                if prio is None or pkts is None or byts is None or acts is None:
                    continue
                try:
                    pkts_i = int(pkts)
                    byts_i = int(byts)
                except Exception:
                    continue
                flows.append((prio, pkts_i, byts_i, acts))
        return flows

    # ---------- Formatting ----------
    def _format_output(self, bridge, flows):
        ts = time.strftime("%Y-%m-%d %H:%M:%S")
        header = f"[{ts}] bridge={bridge}\n"
        header += f"{'Prio':>4} {'Pkts':>6} {'ΔPkt':>5} {'Bytes':>8} {'ΔB':>6} Actions\n"
        header += "-" * 50 + "\n"

        if not flows:
            return header + "Nenhum fluxo encontrado.\n"

        rows = []
        for prio, pkts, byts, acts in flows:
            last_p, last_b = self.last_stats.get(prio, (pkts, byts))
            d_p = pkts - last_p
            d_b = byts - last_b
            self.last_stats[prio] = (pkts, byts)
            rows.append(f"{prio:>4} {pkts:>6} {d_p:+5} {byts:>8} {d_b:+6} {acts}")

        return header + "\n".join(rows) + "\n"

    # ---------- Tick ----------
    def _on_tick(self, msg):
        self._do_update()

    def _do_update(self):
        if time.time() - self.last_update < self.update_interval:
            return
        bridge, raw = self._get_forwarding_table_raw()
        if bridge is None:
            final_output = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {raw}\n"
        else:
            flows = self._parse_flows(raw)
            final_output = self._format_output(bridge, flows)
        print(final_output, end="", flush=True)
        # Emit JSON metrics snapshot
        t_epoch, t_iso = now_ts()
        metrics_payload = {
            "ts": t_epoch,
            "ts_iso": t_iso,
            "module": "forwarding_table_s1",
            "container": self.container_s1,
        }
        if bridge is not None:
            # Include flows with deltas based on last_stats
            flows_json = []
            for prio, pkts, byts, acts in self._parse_flows(raw):
                last_p, last_b = self.last_stats.get(prio, (pkts, byts))
                flows_json.append({
                    "priority": prio,
                    "n_packets": pkts,
                    "n_bytes": byts,
                    "d_packets": pkts - last_p,
                    "d_bytes": byts - last_b,
                    "actions": acts,
                })
            metrics_payload.update({
                "bridge": bridge,
                "flows": flows_json,
            })
        else:
            metrics_payload.update({"error": raw})
        emit_json(self, "metrics", metrics_payload)
        if self.log_to_file:
            try:
                if self._log_fp is None:
                    path = f"{self.log_dir}/forwarding_table_s1.txt"
                    self._log_fp = open(path, "a", buffering=1)
                self._log_fp.write(final_output)
            except Exception as e:
                print(f"[ForwardingTableS1] falha ao logar em arquivo: {e}", flush=True)
        self.message_port_pub(pmt.intern("out"), pmt.to_pmt(final_output))
        self.last_update = time.time()

    def start(self):
        if self.auto_start and self._thread is None:
            self._stop_evt.clear()
            self._thread = threading.Thread(target=self._run_loop, daemon=True)
            self._thread.start()
            print("[ForwardingTableS1] auto-start loop iniciado", flush=True)
        return True

    def stop(self):
        if self._thread is not None:
            self._stop_evt.set()
            self._thread.join(timeout=2.0)
            self._thread = None
        if self._log_fp is not None:
            try:
                self._log_fp.close()
            except Exception:
                pass
        return True

    def _run_loop(self):
        while not self._stop_evt.is_set():
            try:
                self._do_update()
            except Exception as e:
                print(f"[ForwardingTableS1] erro no loop: {e}")
            self._stop_evt.wait(self.update_interval)

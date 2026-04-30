from gnuradio import gr
import time
import dns.resolver
import numpy as np
import pmt
from .metrics import now_ts, emit_json

class DNSResolverMonitorBlock(gr.sync_block):
    """
    GNU Radio Python block that measures DNS query latency against a specific server.

    Parameters:
    - dns_server (str): DNS server IP to query.
    - query_name (str): Domain name to resolve.
    - interval (float): Minimum seconds between queries.

    Output:
    - stream of float32: last measured latency in seconds; -1.0 on error; 0.0 when idle.
    """
    def __init__(self, dns_server='172.18.0.2', query_name='google.com', interval=1.0):
        gr.sync_block.__init__(self,
            name="DNS Resolver/Monitor Block",
            in_sig=[],
            out_sig=[np.float32])
        self.dns_server = dns_server
        self.query_name = query_name
        self.interval = float(interval)
        self.last_time = 0.0
        self.message_port_register_out(pmt.intern("metrics"))

    def work(self, input_items, output_items):
        out = output_items[0]
        now = time.time()
        if now - self.last_time >= self.interval:
            try:
                resolver = dns.resolver.Resolver()
                resolver.nameservers = [self.dns_server]
                start_time = time.time()
                resolver.resolve(self.query_name)
                elapsed = time.time() - start_time
                print(f"[DNS] Consulta {self.query_name} via {self.dns_server}: {elapsed:.4f}s")
                out[:] = [elapsed] * len(out)
                t_epoch, t_iso = now_ts()
                emit_json(self, "metrics", {
                    "ts": t_epoch,
                    "ts_iso": t_iso,
                    "module": "dns_resolver",
                    "server": self.dns_server,
                    "query": self.query_name,
                    "latency_s": float(elapsed),
                    "ok": True,
                })
            except Exception as e:
                print(f"[DNS] Erro consultando {self.query_name} via {self.dns_server}: {e}")
                out[:] = [-1.0] * len(out)
                t_epoch, t_iso = now_ts()
                emit_json(self, "metrics", {
                    "ts": t_epoch,
                    "ts_iso": t_iso,
                    "module": "dns_resolver",
                    "server": self.dns_server,
                    "query": self.query_name,
                    "latency_s": -1.0,
                    "ok": False,
                    "error": str(e),
                })
            self.last_time = now
        else:
            out[:] = [0.0] * len(out)
        return len(out)

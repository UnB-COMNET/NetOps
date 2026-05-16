import json
import os
import time
import pmt

# Default log dir can be overridden via NETMON_LOG_DIR; fallback to ./raw under cwd
DEFAULT_LOG_DIR = os.environ.get("NETMON_LOG_DIR") or os.path.join(os.getcwd(), "raw")


def resolve_log_dir(log_dir=None):
    path = log_dir or DEFAULT_LOG_DIR
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        # Directory creation failure should not crash the block; caller may handle
        pass
    return path


def now_ts():
    t = time.time()
    return t, time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(t))


def emit_json(block, port_name, payload):
    try:
        s = json.dumps(payload, ensure_ascii=False)
        block.message_port_pub(pmt.intern(port_name), pmt.to_pmt(s))
    except Exception:
        # Avoid crashing the flowgraph due to telemetry issues
        pass

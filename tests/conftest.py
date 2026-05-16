import sys
import types
from pathlib import Path

# Ensure project modules are importable in tests
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "gr-netmon" / "python"))
sys.path.insert(0, str(ROOT))

# ---------- Dummy PMT ----------
class _FakePMT:
    @staticmethod
    def intern(name):
        return name

    @staticmethod
    def to_pmt(obj):
        return obj

    @staticmethod
    def from_pmt(obj):
        return obj

pmt = _FakePMT()
sys.modules.setdefault("pmt", pmt)

# ---------- Dummy GNU Radio blocks ----------
class _BlockBase:
    def __init__(self, *args, **kwargs):
        self._handlers = {}
        self.published = []
        self.registered_in = set()
        self.registered_out = set()

    def message_port_register_in(self, name):
        self.registered_in.add(name)

    def message_port_register_out(self, name):
        self.registered_out.add(name)

    def set_msg_handler(self, name, handler):
        self._handlers[name] = handler

    def message_port_pub(self, name, value):
        self.published.append((name, value))

    def trigger(self, name, msg=None):
        if name in self._handlers:
            self._handlers[name](msg)


class FakeBasicBlock(_BlockBase):
    def __init__(self, *args, **kwargs):
        super().__init__()


class FakeSyncBlock(_BlockBase):
    def __init__(self, *args, **kwargs):
        super().__init__()


gr = types.SimpleNamespace(basic_block=FakeBasicBlock, sync_block=FakeSyncBlock)

# Register gnuradio modules
mod_gr = types.ModuleType("gnuradio")
mod_gr.gr = gr
sys.modules.setdefault("gnuradio", mod_gr)
sys.modules.setdefault("gnuradio.gr", gr)

# ---------- Dummy numpy ----------
class _FakeNumpy(types.SimpleNamespace):
    float32 = float

np_mod = _FakeNumpy()
sys.modules.setdefault("numpy", np_mod)

# ---------- Dummy dns.resolver ----------
class _DummyResolver:
    def __init__(self):
        self.nameservers = []

    def resolve(self, name):
        return [name]

resolver_mod = types.SimpleNamespace(Resolver=_DummyResolver)
dns_mod = types.SimpleNamespace(resolver=resolver_mod)
sys.modules.setdefault("dns", dns_mod)
sys.modules.setdefault("dns.resolver", resolver_mod)


# ---------- Helpers ----------
class DummyArray(list):
    """List that accepts slice assignment of scalars like numpy arrays."""

    def __init__(self, length, fill=0.0):
        super().__init__([fill] * length)

    def __setitem__(self, key, value):
        if isinstance(key, slice):
            # replicate scalar across the slice if needed
            if isinstance(value, (int, float, str)):
                super().__setitem__(key, [value] * len(self))
            else:
                super().__setitem__(key, value)
        else:
            super().__setitem__(key, value)


def dummy_thread_runner(target):
    class _DummyThread:
        def __init__(self):
            self._target = target

        def start(self):
            if self._target:
                self._target()

        def join(self, timeout=None):
            return None

    return _DummyThread


__all__ = [
    "pmt",
    "gr",
    "DummyArray",
    "dummy_thread_runner",
]

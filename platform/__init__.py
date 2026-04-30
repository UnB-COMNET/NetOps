from __future__ import annotations

# Forward stdlib platform attributes to avoid shadowing while keeping this package namespace.
import importlib.util
import sys
import sysconfig
from pathlib import Path

_stdlib_path = Path(sysconfig.get_paths()["stdlib"]) / "platform.py"
if _stdlib_path.exists():
	spec = importlib.util.spec_from_file_location("_stdlib_platform", _stdlib_path)
	if spec and spec.loader:
		_stdlib_platform = importlib.util.module_from_spec(spec)
		sys.modules["_stdlib_platform"] = _stdlib_platform
		spec.loader.exec_module(_stdlib_platform)
		for attr in dir(_stdlib_platform):
			if attr.startswith("__"):
				continue
			globals()[attr] = getattr(_stdlib_platform, attr)

__all__ = [k for k in globals().keys() if not k.startswith("__")]
__path__ = [str(Path(__file__).parent)]

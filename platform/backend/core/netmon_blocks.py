from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List


def list_grc_blocks(blocks_dir: Path | None = None) -> List[Dict[str, Any]]:
    try:
        import yaml
    except Exception as exc:  # pragma: no cover - optional dependency
        raise RuntimeError("pyyaml not available") from exc

    base = blocks_dir or Path("gr-netmon") / "grc" / "blocks"
    if not base.exists():
        return []

    items: List[Dict[str, Any]] = []
    for path in sorted(base.glob("*.block.yml")):
        try:
            data = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        params = data.get("parameters") or []
        out = {
            "id": data.get("id"),
            "label": data.get("label"),
            "category": data.get("category"),
            "documentation": data.get("documentation"),
            "parameters": [
                {
                    "id": p.get("id"),
                    "label": p.get("label"),
                    "dtype": p.get("dtype"),
                    "default": p.get("default"),
                }
                for p in params
                if isinstance(p, dict)
            ],
        }
        items.append(out)
    return items

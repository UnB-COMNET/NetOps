from __future__ import annotations

import asyncio
from typing import Any, Dict

from platform.backend.core.registry import registry
from platform.backend.core.plugins import ExperimentRunner


class MininetRunner:
    def __init__(self) -> None:
        self._name = "mininet"

    def name(self) -> str:
        return self._name

    def supported_controllers(self) -> list[str]:
        return ["ryu", "onos", "odl", "floodlight"]

    async def setup(self, context: Dict[str, Any]) -> None:
        # Placeholder: provision topology using Mininet scripts
        await asyncio.sleep(0)

    async def run(self, context: Dict[str, Any]) -> None:
        # Placeholder: trigger experiment lifecycle
        await asyncio.sleep(0)

    async def teardown(self, context: Dict[str, Any]) -> None:
        # Placeholder: clean up topology
        await asyncio.sleep(0)


runner = MininetRunner()
registry.register_runner(runner)

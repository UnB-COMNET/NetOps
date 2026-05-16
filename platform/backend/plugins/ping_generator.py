from __future__ import annotations

import asyncio
from typing import Any, Dict

from platform.backend.core.registry import registry
from platform.backend.core.plugins import TrafficGenerator


class PingGenerator:
    def __init__(self) -> None:
        self._name = "ping"

    def name(self) -> str:
        return self._name

    def supported_protocols(self) -> list[str]:
        return ["icmp"]

    async def start(self, context: Dict[str, Any]) -> None:
        # Placeholder: start ping traffic between endpoints in context
        await asyncio.sleep(0)

    async def stop(self, context: Dict[str, Any]) -> None:
        # Placeholder: stop ping traffic
        await asyncio.sleep(0)


generator = PingGenerator()
registry.register_traffic_generator(generator)

# Importing modules registers plugins via side-effects.
from platform.backend.plugins import csv_collector  # noqa: F401
from platform.backend.plugins import controller_collector  # noqa: F401
from platform.backend.plugins import traffic_collector  # noqa: F401
from platform.backend.plugins import mininet_runner  # noqa: F401
from platform.backend.plugins import ping_generator  # noqa: F401

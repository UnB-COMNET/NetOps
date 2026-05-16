from __future__ import annotations

from typing import Dict, List

from .plugins import ExperimentRunner, MetricCollector, TrafficGenerator, is_experiment_runner, is_metric_collector, is_traffic_generator


class PluginRegistry:
    def __init__(self) -> None:
        self._experiment_runners: Dict[str, ExperimentRunner] = {}
        self._metric_collectors: Dict[str, MetricCollector] = {}
        self._traffic_generators: Dict[str, TrafficGenerator] = {}

    def register_runner(self, runner: ExperimentRunner) -> None:
        if not is_experiment_runner(runner):
            raise TypeError("runner must implement ExperimentRunner")
        self._experiment_runners[runner.name()] = runner

    def register_metric_collector(self, collector: MetricCollector) -> None:
        if not is_metric_collector(collector):
            raise TypeError("collector must implement MetricCollector")
        self._metric_collectors[collector.name()] = collector

    def register_traffic_generator(self, generator: TrafficGenerator) -> None:
        if not is_traffic_generator(generator):
            raise TypeError("generator must implement TrafficGenerator")
        self._traffic_generators[generator.name()] = generator

    def runners(self) -> List[str]:
        return list(self._experiment_runners)

    def metric_collectors(self) -> List[str]:
        return list(self._metric_collectors)

    def traffic_generators(self) -> List[str]:
        return list(self._traffic_generators)

    def get_runner(self, name: str) -> ExperimentRunner:
        return self._experiment_runners[name]

    def get_metric_collector(self, name: str) -> MetricCollector:
        return self._metric_collectors[name]

    def get_traffic_generator(self, name: str) -> TrafficGenerator:
        return self._traffic_generators[name]


registry = PluginRegistry()

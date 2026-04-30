"use client";

import { useCallback, useState } from "react";
import {
  experimentApi,
  runApi,
  type Experiment,
  type ExperimentCreate,
  type ExperimentRun,
} from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";

export function useExperiments() {
  return useAsync(() => experimentApi.list(), []);
}

export function useExperimentRuns(experimentId: string | null) {
  return useAsync(
    () => (experimentId ? experimentApi.listRuns(experimentId) : Promise.resolve([])),
    [experimentId],
  );
}

export function useRunMetrics(runId: string | null) {
  return useAsync(
    () => (runId ? runApi.metrics(runId) : Promise.resolve([])),
    [runId],
  );
}

export function useExperimentMutations(apiKey?: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createExperiment = useCallback(
    async (payload: ExperimentCreate): Promise<Experiment | null> => {
      setBusy(true);
      setError(null);
      try {
        return await experimentApi.create(payload, apiKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [apiKey],
  );

  const startRun = useCallback(
    async (
      experimentId: string,
      mode = "synthetic",
    ): Promise<ExperimentRun | null> => {
      setBusy(true);
      setError(null);
      try {
        return await experimentApi.startRun(experimentId, mode, apiKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [apiKey],
  );

  const deleteExperiment = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await experimentApi.delete(id, apiKey);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apiKey],
  );

  return { createExperiment, startRun, deleteExperiment, busy, error };
}

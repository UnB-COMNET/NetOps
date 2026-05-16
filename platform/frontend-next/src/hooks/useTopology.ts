"use client";

import { useCallback, useState } from "react";
import { topologyApi, type Topology, type TopologyCreate, type TopologyUpdate } from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";

export function useTopologies() {
  return useAsync(() => topologyApi.list(), []);
}

export function useTopology(id: string | null) {
  return useAsync(
    () => (id ? topologyApi.get(id) : Promise.resolve(null)),
    [id],
  );
}

export function useTopologyMutations(apiKey?: string) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTopology = useCallback(
    async (payload: TopologyCreate): Promise<Topology | null> => {
      setSaving(true);
      setError(null);
      try {
        return await topologyApi.create(payload, apiKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [apiKey],
  );

  const updateTopology = useCallback(
    async (id: string, payload: TopologyUpdate): Promise<Topology | null> => {
      setSaving(true);
      setError(null);
      try {
        return await topologyApi.update(id, payload, apiKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [apiKey],
  );

  const deleteTopology = useCallback(
    async (id: string): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        await topologyApi.delete(id, apiKey);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [apiKey],
  );

  return { createTopology, updateTopology, deleteTopology, saving, error };
}

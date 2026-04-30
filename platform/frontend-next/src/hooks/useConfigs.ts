"use client";

import { useCallback, useState } from "react";
import {
  configApi,
  type ConfigPayload,
} from "@/lib/api";
import { useAsync } from "@/hooks/useAsync";

export function useConfigs() {
  return useAsync(() => configApi.list(), []);
}

export function useActiveConfig() {
  return useAsync(() => configApi.getActive(), []);
}

export function useConfigPayload(id: string | null) {
  return useAsync(
    () => (id ? configApi.get(id) : Promise.resolve(null)),
    [id],
  );
}

export function useConfigMutations(apiKey?: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveConfig = useCallback(
    async (payload: ConfigPayload): Promise<{ saved: boolean; id: string; active: string | null } | null> => {
      setBusy(true);
      setError(null);
      try {
        return await configApi.save(payload, apiKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [apiKey],
  );

  const activateConfig = useCallback(
    async (id: string): Promise<{ active: string } | null> => {
      setBusy(true);
      setError(null);
      try {
        return await configApi.activate(id, apiKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [apiKey],
  );

  const deleteConfig = useCallback(
    async (id: string): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        await configApi.delete(id, apiKey);
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

  return { saveConfig, activateConfig, deleteConfig, busy, error };
}

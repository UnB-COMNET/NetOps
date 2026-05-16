"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  openEventStream,
  type SSESnapshot,
} from "@/lib/api";

/**
 * Subscribes to the backend SSE /stream/events.
 * Reconnects automatically after a short delay on error.
 */
export function useSSE() {
  const [snapshot, setSnapshot] = useState<SSESnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    const cleanup = openEventStream(
      (data) => {
        setSnapshot(data);
        setConnected(true);
        setError(null);
      },
      (_err) => {
        setConnected(false);
        setError("SSE connection lost – retrying…");
        cleanup();
        // Reconnect after 3 s
        retryRef.current = setTimeout(connect, 3000);
      },
    );

    return cleanup;
  }, []);

  useEffect(() => {
    const cleanup = connect();
    return () => {
      cleanup();
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, [connect]);

  return { snapshot, connected, error };
}

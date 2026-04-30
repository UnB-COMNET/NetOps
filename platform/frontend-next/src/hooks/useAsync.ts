"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AsyncState<T> =
  | { status: "idle"; data: null; error: null }
  | { status: "loading"; data: null; error: null }
  | { status: "success"; data: T; error: null }
  | { status: "error"; data: null; error: string };

/**
 * Generic hook that wraps an async fetcher.
 * Accepts an optional `deps` array that re-triggers the fetch.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    status: "idle",
    data: null,
    error: null,
  });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(() => {
    setState({ status: "loading", data: null, error: null });
    fetcherRef
      .current()
      .then((data) => setState({ status: "success", data, error: null }))
      .catch((err: unknown) =>
        setState({
          status: "error",
          data: null,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);

  return { ...state, refetch: run };
}

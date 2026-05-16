"use client";

import { useEffect, useRef, useState } from "react";

export function useTimeSeries({
  initial,
  step,
  min,
  max,
  points = 36,
  intervalMs = 900,
}: {
  initial: number;
  step: number;
  min: number;
  max: number;
  points?: number;
  intervalMs?: number;
}) {
  const [series, setSeries] = useState<number[]>(() => {
    const arr: number[] = [];
    let v = initial;
    for (let i = 0; i < points; i++) {
      arr.push(v);
      v = v + (Math.random() * 2 - 1) * (step / 2);
    }
    return arr;
  });

  const lastRef = useRef(series[series.length - 1] ?? initial);

  useEffect(() => {
    const id = setInterval(() => {
      setSeries((prev) => {
        const last = lastRef.current;
        const delta = (Math.random() * 2 - 1) * step;
        const next = Math.max(min, Math.min(max, last + delta));
        lastRef.current = next;
        const nextArr = [...prev.slice(1), next];
        return nextArr;
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [intervalMs, max, min, step]);

  const value = series[series.length - 1] ?? initial;
  return { value, series };
}

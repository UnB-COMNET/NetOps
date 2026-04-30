/**
 * LTTB — Largest-Triangle-Three-Buckets
 *
 * The de-facto standard for visually lossless time-series downsampling.
 * Preserves peaks, valleys, and shape better than uniform sub-sampling while
 * running in O(n) time (one pass over the data after bucket partitioning).
 *
 * Reference: Sveinn Steinarsson, "Downsampling Time Series for Visual
 * Representation", MSc thesis, University of Iceland, 2013.
 *
 * Usage
 * ─────
 *   import { lttb, lttbAdaptive } from "@/lib/lttb";
 *
 *   // Down-sample to exactly 300 points
 *   const small = lttb(bigArray, 300);
 *
 *   // Choose threshold automatically based on a byte budget
 *   const small = lttbAdaptive(bigArray, { byteBudget: 50_000 });
 */

// ── Core algorithm ────────────────────────────────────────────────────────────

/**
 * Down-sample `data` to at most `threshold` points using LTTB.
 *
 * - If `data.length <= threshold` the original array is returned as-is (no
 *   copy), so callers pay zero cost for short series.
 * - Complexity: O(n) time, O(threshold) space.
 * - The first and last points are always kept (anchoring).
 */
export function lttb(data: number[], threshold: number): number[] {
  const n = data.length;
  if (n <= threshold || threshold < 3) return data;

  const sampled: number[] = new Array(threshold);
  sampled[0] = data[0]!;

  const bucketSize = (n - 2) / (threshold - 2);
  let a = 0; // index of the last selected point

  for (let i = 0; i < threshold - 2; i++) {
    // ── Next bucket: compute its average (used as the "future" anchor) ──────
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
    let avgX = 0;
    let avgY = 0;
    const nextBucketLen = nextBucketEnd - nextBucketStart;
    for (let j = nextBucketStart; j < nextBucketEnd; j++) {
      avgX += j;
      avgY += data[j]!;
    }
    avgX /= nextBucketLen;
    avgY /= nextBucketLen;

    // ── Current bucket: pick the point forming the largest triangle ──────────
    const currentBucketStart = Math.floor(i * bucketSize) + 1;
    const currentBucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n);
    const ax = a;
    const ay = data[a]!;

    let maxArea = -1;
    let maxIdx = currentBucketStart;

    for (let j = currentBucketStart; j < currentBucketEnd; j++) {
      // Absolute area of the triangle formed by (ax,ay), (j, data[j]), (avgX, avgY)
      const area = Math.abs(
        (ax - avgX) * (data[j]! - ay) - (ax - j) * (avgY - ay),
      );
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }

    sampled[i + 1] = data[maxIdx]!;
    a = maxIdx;
  }

  sampled[threshold - 1] = data[n - 1]!;
  return sampled;
}

// ── Adaptive helper ───────────────────────────────────────────────────────────

/**
 * Choose the LTTB threshold automatically so the resulting array fits within
 * `byteBudget` bytes (treating each number as 8 bytes in memory / JSON).
 *
 * `minPoints` (default 50) and `maxPoints` (default 4000) bound the result.
 */
export function lttbAdaptive(
  data: number[],
  opts: { byteBudget: number; minPoints?: number; maxPoints?: number },
): number[] {
  const { byteBudget, minPoints = 50, maxPoints = 4000 } = opts;
  const bytesPerPoint = 8; // conservative: JSON float ≈ 6–9 chars
  const threshold = Math.max(
    minPoints,
    Math.min(maxPoints, Math.floor(byteBudget / bytesPerPoint)),
  );
  return lttb(data, threshold);
}

// ── SeriesMap helper ──────────────────────────────────────────────────────────

/**
 * Apply LTTB to every series in a SeriesMap.
 *
 * The per-key byte budget is `totalByteBudget / numKeys`, ensuring the total
 * payload stays within `totalByteBudget` regardless of how many metrics are
 * selected.  Series shorter than the computed threshold are returned as-is.
 *
 * Complexity: O(Σ nᵢ) — one pass per series.
 */
export function lttbSeriesMap(
  seriesMap: Record<string, number[]>,
  totalByteBudget: number,
  opts?: { minPoints?: number; maxPoints?: number },
): Record<string, number[]> {
  const keys = Object.keys(seriesMap);
  if (keys.length === 0) return seriesMap;

  const perKeyBudget = Math.floor(totalByteBudget / keys.length);

  const result: Record<string, number[]> = {};
  for (const k of keys) {
    result[k] = lttbAdaptive(seriesMap[k]!, {
      byteBudget: perKeyBudget,
      minPoints: opts?.minPoints ?? 50,
      maxPoints: opts?.maxPoints ?? 4000,
    });
  }
  return result;
}

export function mean(values: number[]) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function sorted(values: number[]) {
  const arr = values.slice();
  arr.sort((a, b) => a - b);
  return arr;
}

// Linear interpolation quantile for q in [0, 1].
export function quantile(values: number[], q: number) {
  if (values.length === 0) return 0;
  const qq = Math.max(0, Math.min(1, q));
  const arr = sorted(values);
  const idx = (arr.length - 1) * qq;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return arr[lo] ?? 0;
  const a = arr[lo] ?? 0;
  const b = arr[hi] ?? 0;
  const t = idx - lo;
  return a + (b - a) * t;
}

export function median(values: number[]) {
  return quantile(values, 0.5);
}

export function percentile(values: number[], p: number) {
  return quantile(values, p / 100);
}

export function p95(values: number[]) {
  return quantile(values, 0.95);
}

export function p99(values: number[]) {
  return quantile(values, 0.99);
}

export function variance(values: number[]) {
  if (values.length === 0) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return acc / values.length;
}

export function stddev(values: number[]) {
  return Math.sqrt(variance(values));
}

export function sampleVariance(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values);
  let acc = 0;
  for (const v of values) {
    const d = v - m;
    acc += d * d;
  }
  return acc / (values.length - 1);
}

export function sampleStddev(values: number[]) {
  return Math.sqrt(sampleVariance(values));
}

// Approximate 95% confidence interval for the mean using normal approximation.
// For n>=30 it's typically reasonable; for small n this is still a useful heuristic.
export function confidenceInterval95(values: number[]) {
  const n = values.length;
  if (n === 0) return { mean: 0, halfWidth: 0, low: 0, high: 0, n };
  const m = mean(values);
  if (n === 1) return { mean: m, halfWidth: 0, low: m, high: m, n };
  const s = sampleStddev(values);
  const z = 1.96;
  const halfWidth = z * (s / Math.sqrt(n));
  return { mean: m, halfWidth, low: m - halfWidth, high: m + halfWidth, n };
}

export function pearsonR(x: number[], y: number[]) {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i] ?? 0;
    sumY += y[i] ?? 0;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? 0) - meanX;
    const dy = (y[i] ?? 0) - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den < 1e-12) return 0;
  return num / den;
}

export function zScores(values: number[]) {
  if (values.length === 0) return [] as number[];
  const m = mean(values);
  const s = stddev(values);
  if (s < 1e-12) return values.map(() => 0);
  return values.map((v) => (v - m) / s);
}

export function outlierIndicesZ(values: number[], threshold = 3) {
  const zs = zScores(values);
  const out: number[] = [];
  for (let i = 0; i < zs.length; i++) {
    if (Math.abs(zs[i] ?? 0) >= threshold) out.push(i);
  }
  return out;
}

export function quartiles(values: number[]) {
  if (values.length === 0) return { q1: 0, q2: 0, q3: 0 };
  return { q1: quantile(values, 0.25), q2: quantile(values, 0.5), q3: quantile(values, 0.75) };
}

export function iqr(values: number[]) {
  const { q1, q3 } = quartiles(values);
  return q3 - q1;
}

export function boxPlotStats(values: number[]) {
  if (values.length === 0) {
    return {
      min: 0,
      max: 0,
      q1: 0,
      median: 0,
      q3: 0,
      whiskerLow: 0,
      whiskerHigh: 0,
      outliers: [] as number[],
    };
  }

  const arr = sorted(values);
  const { q1, q2, q3 } = quartiles(arr);
  const span = Math.max(1e-12, q3 - q1);
  const lowFence = q1 - 1.5 * span;
  const highFence = q3 + 1.5 * span;

  let whiskerLow = arr[0] ?? 0;
  let whiskerHigh = arr[arr.length - 1] ?? 0;
  for (const v of arr) {
    if (v >= lowFence) {
      whiskerLow = v;
      break;
    }
  }
  for (let i = arr.length - 1; i >= 0; i--) {
    const v = arr[i] ?? 0;
    if (v <= highFence) {
      whiskerHigh = v;
      break;
    }
  }

  const outliers: number[] = [];
  for (const v of arr) {
    if (v < lowFence || v > highFence) outliers.push(v);
  }

  return {
    min: arr[0] ?? 0,
    max: arr[arr.length - 1] ?? 0,
    q1,
    median: q2,
    q3,
    whiskerLow,
    whiskerHigh,
    outliers,
  };
}

export function coeffOfVariation(values: number[]) {
  const m = mean(values);
  if (Math.abs(m) < 1e-9) return 0;
  return stddev(values) / Math.abs(m);
}

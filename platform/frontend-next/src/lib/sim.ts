export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function randomWalk(prev: number, step: number, min: number, max: number) {
  const delta = (Math.random() * 2 - 1) * step;
  return clamp(prev + delta, min, max);
}

export function formatPct(value: number) {
  return `${value.toFixed(0)}%`;
}

export function formatMs(value: number) {
  return `${value.toFixed(1)} ms`;
}

export function formatMbps(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} Gbps`;
  return `${value.toFixed(1)} Mbps`;
}

export function formatLoss(value: number) {
  return `${value.toFixed(2)}%`;
}

export function isoNow() {
  return new Date().toISOString();
}

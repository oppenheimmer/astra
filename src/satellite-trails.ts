import type { SatellitePass } from "./satellite-pass";

/** Transfer pass samples without cloning thousands of individual point objects. */
export function packPasses(passes: SatellitePass[]) {
  const points = new Float64Array(passes.reduce((n, pass) => n + pass.points.length * 3, 0));
  const offsets = [0];
  let i = 0;
  for (const pass of passes) {
    for (const p of pass.points) { points[i++] = p.time; points[i++] = p.az; points[i++] = p.alt; }
    offsets.push(i);
  }
  return { points, offsets };
}
export type PackedPasses = ReturnType<typeof packPasses>;
export const passContains = (points: Float64Array, time: number) =>
  !!points.length && time >= points[0] && time <= points[points.length - 3];

/** Offset of the first sample at or after the displayed time. */
export function passSplit(points: Float64Array, time: number) {
  let lo = 0, hi = points.length / 3;
  while (lo < hi) {
    const middle = Math.floor((lo + hi) / 2);
    if (points[middle * 3] < time) lo = middle + 1;
    else hi = middle;
  }
  return lo * 3;
}

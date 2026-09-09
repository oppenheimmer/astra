import type { TerrainProfile } from "./types";
import { wrap } from "./projection";
export function horizonAltitude(profile: TerrainProfile, az: number): number {
  const n = profile.altitudes.length;
  const x = (wrap(az) / 360) * n,
    i = Math.floor(x),
    t = x - i;
  return (
    profile.altitudes[i % n] * (1 - t) + profile.altitudes[(i + 1) % n] * t
  );
}
export function validTerrain(value: unknown): value is TerrainProfile {
  const p = value as TerrainProfile;
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lon) &&
    Number.isFinite(p.heightAboveGround) &&
    Array.isArray(p.altitudes) &&
    p.altitudes.length >= 48 &&
    p.altitudes.every((n) => Number.isFinite(n) && n >= 0 && n < 90)
  );
}

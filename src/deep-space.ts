import * as A from "astronomy-engine";
import { RAD } from "./projection";
import type { DeepSpaceData } from "./types";

export const AU_KM = 149597870.7;
/** Closer than this a craft is drawn to scale; farther out it is a direction marker at the chart edge. */
export const NEAR_SPACE_KM = 5e6;
const REGIONS = new Set(["L1", "L2", ""]);
type Vector = [number, number, number];

/** Validate the published Horizons samples; anything malformed rejects the whole response. */
export function parseDeepSpace(value: unknown): DeepSpaceData | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.fetchedAt !== "string" || typeof v.source !== "string" || typeof v.start !== "string" ||
      !Number.isFinite(Date.parse(v.start)) || !Number.isSafeInteger(v.step) || (v.step as number) <= 0 ||
      !Number.isSafeInteger(v.count) || (v.count as number) < 2 || !Array.isArray(v.craft)) return null;
  const count = v.count as number;
  const craft = [];
  for (const item of v.craft as unknown[]) {
    const c = item as Record<string, unknown>;
    if (!c || typeof c !== "object" || typeof c.id !== "string" || typeof c.name !== "string" || !c.name ||
        !REGIONS.has(c.region as string) || !Array.isArray(c.positions) || c.positions.length !== count * 3 ||
        !c.positions.every(Number.isFinite)) return null;
    craft.push({ id: c.id, name: c.name, region: c.region as "L1" | "L2" | "", positions: c.positions as number[] });
  }
  return { fetchedAt: v.fetchedAt, source: v.source, start: v.start, step: v.step as number, count, craft };
}

/** Geocentric ICRF position in km, interpolated between samples; null outside the sampled window. */
export function craftPosition(data: DeepSpaceData, index: number, time: number): Vector | null {
  const t = (time - Date.parse(data.start)) / data.step;
  if (!(t >= 0 && t <= data.count - 1)) return null;
  const i = Math.min(Math.floor(t), data.count - 2),
    f = t - i,
    p = data.craft[index].positions;
  return [0, 1, 2].map((k) => p[i * 3 + k] + f * (p[(i + 1) * 3 + k] - p[i * 3 + k])) as Vector;
}

/**
 * Turn J2000 (ICRF) geocentric vectors into the Earth-fixed frame at an instant:
 * precession and nutation to the true equator of date, then Earth's rotation.
 */
export function earthFixedAt(time: Date) {
  const t = A.MakeTime(time),
    rotation = A.Rotation_EQJ_EQD(t),
    angle = A.SiderealTime(t) * 15 * RAD,
    c = Math.cos(angle),
    s = Math.sin(angle);
  return ([x, y, z]: Vector): Vector => {
    const e = A.RotateVector(rotation, new A.Vector(x, y, z, t));
    return [e.x * c + e.y * s, -e.x * s + e.y * c, e.z];
  };
}

/** The Moon's geocentric J2000 position in km. */
export function moonPosition(time: Date): Vector {
  const m = A.GeoMoon(time);
  return [m.x * AU_KM, m.y * AU_KM, m.z * AU_KM];
}

/** One sidereal month of the Moon's J2000 path around `time`, for drawing its orbit. */
export function moonOrbit(time: number, samples = 120): Vector[] {
  const month = 27.321661 * 86400000;
  return Array.from({ length: samples + 1 }, (_, i) => moonPosition(new Date(time + (i / samples - 0.5) * month)));
}

/** The Sun's geocentric J2000 direction. */
export function sunPosition(time: Date): Vector {
  const v = A.GeoVector(A.Body.Sun, time, true);
  return [v.x * AU_KM, v.y * AU_KM, v.z * AU_KM];
}

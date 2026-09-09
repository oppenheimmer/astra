import * as S from "satellite.js";
import type { Satellite, Site } from "./types";
import { angularDistance, clamp, RAD, wrap } from "./projection";

export interface TrackPoint {
  time: number;
  az: number;
  alt: number;
}
export interface SatellitePass {
  points: TrackPoint[];
  rises: boolean;
  sets: boolean;
}
const cache = new WeakMap<Satellite, Map<string, SatellitePass>>();

function position(sat: Satellite, time: number, site: Site): TrackPoint | null {
  try {
    const date = new Date(time),
      pv = S.propagate(sat.record, date);
    if (!pv?.position || typeof pv.position === "boolean") return null;
    const look = S.ecfToLookAngles(
      {
        latitude: site.lat * RAD,
        longitude: site.lon * RAD,
        height: site.elevation / 1000,
      },
      S.eciToEcf(pv.position, S.gstime(date)),
    );
    if (!Number.isFinite(look.elevation)) return null;
    return { time, az: wrap(look.azimuth / RAD), alt: look.elevation / RAD };
  } catch {
    return null;
  }
}

/** The continuous above-horizon pass containing `time`, bounded to two orbits / 48 hours. */
export function satellitePass(
  sat: Satellite,
  time: number,
  site: Site,
): SatellitePass {
  const key = `${site.lat},${site.lon},${site.elevation}`;
  const previous = cache.get(sat)?.get(key);
  if (
    previous &&
    time >= previous.points[0]?.time &&
    time <= previous.points.at(-1)!.time
  )
    return previous;
  const current = position(sat, time, site);
  if (!current || current.alt < 0)
    return { points: [], rises: false, sets: false };
  const motion = Number(sat.elements.MEAN_MOTION);
  const period = motion > 0 ? 86400 / motion : 6000;
  const duration = Math.min(2 * period, 172800) * 1000;
  const step = clamp(period / 400, 8, 90) * 1000;
  const boundary = (inside: TrackPoint, outside: TrackPoint) => {
    for (let i = 0; i < 20 && Math.abs(outside.time - inside.time) > 10; i++) {
      const middle = position(sat, (inside.time + outside.time) / 2, site);
      if (!middle) break;
      if (middle.alt >= 0) inside = middle;
      else outside = middle;
    }
    return { ...inside, alt: 0 };
  };
  const trace = (sign: number) => {
    const points = [current];
    for (let elapsed = step; elapsed <= duration + step; elapsed += step) {
      const point = position(
        sat,
        time + sign * Math.min(elapsed, duration),
        site,
      );
      if (!point) return { points, crossed: false };
      if (point.alt < 0) {
        points.push(boundary(points.at(-1)!, point));
        return { points, crossed: true };
      }
      points.push(point);
      if (elapsed >= duration) break;
    }
    return { points, crossed: false };
  };
  const past = trace(-1),
    future = trace(1);
  const coarse = [...past.points.reverse(), ...future.points.slice(1)];
  // Add detail near fast, overhead passes without oversampling the whole orbit.
  const points: TrackPoint[] = [];
  const refine = (a: TrackPoint, b: TrackPoint, depth = 0) => {
    const distance = angularDistance(a.az / 15, a.alt, b.az / 15, b.alt);
    if (distance > 1.5 && depth < 8) {
      const middle = position(sat, (a.time + b.time) / 2, site);
      if (middle && middle.alt >= 0) {
        refine(a, middle, depth + 1);
        refine(middle, b, depth + 1);
        return;
      }
    }
    points.push(a);
  };
  for (let i = 0; i < coarse.length - 1; i++) refine(coarse[i], coarse[i + 1]);
  points.push(coarse.at(-1)!);
  const pass = { points, rises: past.crossed, sets: future.crossed };
  const sites = cache.get(sat) || new Map<string, SatellitePass>();
  sites.set(key, pass);
  if (sites.size > 4) sites.delete(sites.keys().next().value!);
  cache.set(sat, sites);
  return pass;
}

export function splitPass(pass: SatellitePass, current: TrackPoint) {
  return {
    past: [...pass.points.filter((p) => p.time < current.time), current],
    future: [current, ...pass.points.filter((p) => p.time > current.time)],
  };
}

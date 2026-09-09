import type { Star, View } from "./types";
import { angularDistance, PERSONAL_ASPECT, RAD, wrap } from "./projection";

export const DEEP_MAGNITUDE = 14;
export const OVERVIEW_MAGNITUDE = 9;
export const deepFieldLimit = (magnitude: number) =>
  magnitude <= 10 ? 40 : magnitude <= 12 ? 20 : 10;

/** ICRS direction at a Julian year. Gaia uses epoch 2016; HYG uses 2000. */
export function starPosition(star: Star, year: number) {
  const a = star.ra * 15 * RAD,
    d = star.dec * RAD;
  const dt = ((year - (star.epoch ?? 2000)) * RAD) / 3600000;
  const pa = (star.pmra || 0) * dt,
    pd = (star.pmdec || 0) * dt;
  const x =
    Math.cos(d) * Math.cos(a) -
    pa * Math.sin(a) -
    pd * Math.sin(d) * Math.cos(a);
  const y =
    Math.cos(d) * Math.sin(a) +
    pa * Math.cos(a) -
    pd * Math.sin(d) * Math.sin(a);
  const z = Math.sin(d) + pd * Math.cos(d);
  return {
    ra: wrap(Math.atan2(y, x) / RAD) / 15,
    dec: Math.atan2(z, Math.hypot(x, y)) / RAD,
  };
}

export interface StarField {
  ra: number; // degrees, ICRS
  dec: number;
  radius: number;
  magnitude: number;
}

/** A containing cone for either circular or rectangular chart geometry. */
export function fieldRadius(view: View) {
  return view.mode === "personal"
    ? (2 *
        Math.atan(
          Math.tan((view.fov * RAD) / 4) * Math.hypot(1, PERSONAL_ASPECT),
        )) /
        RAD
    : view.fov / 2;
}

export function containsField(outer: StarField, inner: StarField) {
  return (
    outer.magnitude >= inner.magnitude &&
    angularDistance(outer.ra / 15, outer.dec, inner.ra / 15, inner.dec) +
      inner.radius <=
      outer.radius
  );
}

export function paddedField(field: StarField): StarField {
  return {
    ...field,
    ra: wrap(Math.round(field.ra * 10) / 10),
    dec: Math.round(field.dec * 10) / 10,
    radius: Math.min(
      field.magnitude <= 10 ? 32 : field.magnitude <= 12 ? 16 : 8,
      Math.ceil((field.radius * 1.15 + 0.2) * 2) / 2,
    ),
  };
}

const matchers = new WeakMap<Star[], (star: Star) => boolean>();

/** Catalogue identities and positions are fixed, so reuse matching across time/view changes. */
function baseMatcher(base: Star[]) {
  const cached = matchers.get(base);
  if (cached) return cached;
  const hip = new Set(base.map((s) => s.hip).filter(Boolean));
  const ids = new Set(base.map((s) => s.id));
  // Nearby stars absent from Hipparcos get a conservative, epoch-matched position check.
  const cell = RAD / 3600;
  const vector = (ra: number, dec: number) => [
    Math.cos(dec * RAD) * Math.cos(ra * 15 * RAD),
    Math.cos(dec * RAD) * Math.sin(ra * 15 * RAD),
    Math.sin(dec * RAD),
  ];
  const index = new Map<string, number[][]>();
  for (const star of base.filter((s) => !s.hip)) {
    const pos = starPosition(star, 2016),
      v = vector(pos.ra, pos.dec),
      [x, y, z] = v.map(n => Math.floor(n / cell));
    // Expand the small HYG index once, rather than looking in 27 cells for
    // each of the much larger Gaia sample. Exact one-arcsecond checks remain.
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${x + dx},${y + dy},${z + dz}`;
          const bucket = index.get(key);
          if (bucket) bucket.push(v);
          else index.set(key, [v]);
        }
  }
  const nearbyMatch = (star: Star) => {
    const v = vector(star.ra, star.dec),
      [x, y, z] = v.map((n) => Math.floor(n / cell));
    return index.get(`${x},${y},${z}`)?.some(
      p => Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2]) < cell,
    ) ?? false;
  };
  const matches = new WeakMap<Star, boolean>();
  const match = (star: Star) => {
    const previous = matches.get(star);
    if (previous !== undefined) return previous;
    const duplicate = ids.has(star.id) || (!!star.hip && hip.has(star.hip)) || nearbyMatch(star);
    matches.set(star, duplicate);
    return duplicate;
  };
  matchers.set(base, match);
  return match;
}

/** Keep HYG names/details when Gaia's official Hipparcos cross-match identifies the same star. */
export function mergeStars(base: Star[], deep: Star[], pinned: Star | null) {
  if (!deep.length && !pinned) return base;
  const matchesBase = baseMatcher(base);
  const ids = new Set<string>();
  const result = [...base];
  for (const star of [...deep, ...(pinned ? [pinned] : [])]) {
    if (ids.has(star.id) || matchesBase(star)) continue;
    result.push(star);
    ids.add(star.id);
  }
  return result;
}

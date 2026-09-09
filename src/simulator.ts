import type { Sky, Telescope } from "./types";
import { moveEquatorial } from "./projection";
import { equatorialToHorizontal, horizontalToEquatorial } from "./sky";

export function stopTelescope(t: Telescope, sky: Sky): Telescope {
  const h = equatorialToHorizontal(t.ra, t.dec, sky.time, sky.site);
  return {
    ...t,
    moving: false,
    tracking: false,
    targetId: null,
    targetRa: t.ra,
    targetDec: t.dec,
    holdAz: h.az,
    holdAlt: h.alt,
  };
}

export function advanceTelescope(
  t: Telescope,
  seconds: number,
  sky: Sky,
): Telescope {
  if (!t.connected) return t;
  // Motors off: hold a direction relative to Earth while the sky turns past.
  if (
    !t.tracking &&
    !t.moving &&
    t.holdAz !== undefined &&
    t.holdAlt !== undefined
  ) {
    const e = horizontalToEquatorial(t.holdAz, t.holdAlt, sky.time, sky.site);
    return Math.abs(e.ra - t.ra) + Math.abs(e.dec - t.dec) < 1e-8
      ? t
      : { ...t, ...e };
  }
  const object = t.targetId ? sky.byId.get(t.targetId) : undefined;
  const ra = object && t.tracking ? object.ra : t.targetRa;
  const dec = object && t.tracking ? object.dec : t.targetDec;
  if (t.moving) {
    const step = moveEquatorial(t.ra, t.dec, ra, dec, 2 * Math.max(0, seconds));
    return {
      ...t,
      ra: step.ra,
      dec: step.dec,
      targetRa: ra,
      targetDec: dec,
      moving: !step.arrived,
    };
  }
  if (
    object &&
    t.tracking &&
    Math.abs(ra - t.ra) + Math.abs(dec - t.dec) > 1e-8
  )
    return { ...t, ra, dec, targetRa: ra, targetDec: dec };
  return t;
}

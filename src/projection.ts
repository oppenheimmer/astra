import type { View } from "./types";
export const RAD = Math.PI / 180;
export const wrap = (n: number) => ((n % 360) + 360) % 360;
export const clamp = (x: number, min: number, max: number) =>
  Math.min(max, Math.max(min, x));
export const compass = (az: number) =>
  ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(wrap(az) / 45) % 8];

/** An upright conformal view of a 90° sector, from horizon to zenith. */
export function personalView(view: View, fov = view.fov): View {
  const field = clamp(fov, 0.1, 90);
  return {
    ...view,
    mode: "personal",
    az: wrap(view.az),
    alt: clamp(view.alt, field / 2, 90 - field / 2),
    fov: field,
    roll: 0,
  };
}

/** Full-view wedge half-width / half-height, with room for its curved rim. */
export const PERSONAL_ASPECT = 1.14;
export function inPersonalSector(az: number, alt: number, heading: number) {
  return (
    alt >= -1e-7 &&
    alt <= 90 + 1e-7 &&
    (alt > 89.999999 || Math.abs(wrap(az - heading + 180) - 180) <= 45 + 1e-7)
  );
}
export function personalBoundary(heading: number) {
  const points = [];
  for (let i = 0; i <= 180; i++)
    points.push({ az: heading - 45 + i / 2, alt: 0 });
  for (let i = 1; i <= 180; i++) points.push({ az: heading + 45, alt: i / 2 });
  for (let i = 179; i >= 0; i--) points.push({ az: heading - 45, alt: i / 2 });
  return points;
}

/** Sample an object's actual circular limb on the celestial sphere. */
export function angularLimb(az: number, alt: number, diameter: number) {
  const { forward, right, up } = basis({ mode: "horizon", az, alt, fov: 90 });
  const radius = (diameter * RAD) / 2;
  return Array.from({ length: 96 }, (_, i) => {
    const angle = (i * Math.PI) / 48;
    const v = forward.map(
      (n, j) =>
        n * Math.cos(radius) +
        (right[j] * Math.cos(angle) + up[j] * Math.sin(angle)) *
          Math.sin(radius),
    );
    return {
      az: wrap(Math.atan2(v[0], v[1]) / RAD),
      alt: Math.asin(clamp(v[2], -1, 1)) / RAD,
    };
  });
}
export function direction(az: number, alt: number): number[] {
  const a = az * RAD,
    h = alt * RAD;
  return [Math.cos(h) * Math.sin(a), Math.cos(h) * Math.cos(a), Math.sin(h)];
}
const dot = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i], 0);
const cross = (a: number[], b: number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function basis(view: View) {
  const a = view.az * RAD,
    h = view.alt * RAD,
    roll = (view.roll || 0) * RAD;
  const right = [Math.cos(a), -Math.sin(a), 0];
  const up = [
    -Math.sin(h) * Math.sin(a),
    -Math.sin(h) * Math.cos(a),
    Math.cos(h),
  ];
  return {
    forward: direction(view.az, view.alt),
    right: right.map((n, i) => n * Math.cos(roll) + up[i] * Math.sin(roll)),
    up: up.map((n, i) => n * Math.cos(roll) - right[i] * Math.sin(roll)),
  };
}
const perspective = (view: View): View =>
  view.mode === "allsky"
    ? { mode: "horizon", az: 180, alt: 90, roll: 0, fov: 150 }
    : view;

/** Rotate the whole spherical camera so a sky direction lands at a screen point. */
export function anchorDirection(
  view: View,
  anchor: { az: number; alt: number },
  x: number,
  y: number,
  cx: number,
  cy: number,
  r: number,
  aspect = 1,
): View {
  const next = perspective(view);
  const under = unproject(x, y, next, cx, cy, r, true, aspect)!;
  if (next.mode === "personal") {
    // Solve the upright spherical camera directly. A wide-view vertical drag
    // is constrained at 45°, while zoom can change both heading and elevation.
    const tx = ((x - cx) / r) * Math.tan((next.fov * RAD) / 4);
    const ty = (-(y - cy) / r) * Math.tan((next.fov * RAD) / 4);
    const den = 1 + tx * tx + ty * ty;
    const forward = (1 - tx * tx - ty * ty) / den,
      right = (2 * tx) / den,
      up = (2 * ty) / den;
    const phase = Math.atan2(up, forward),
      length = Math.hypot(forward, up);
    const elevation =
      Math.asin(
        clamp(Math.sin(anchor.alt * RAD) / Math.max(1e-12, length), -1, 1),
      ) - phase;
    const result = personalView({ ...next, alt: elevation / RAD });
    const along =
      forward * Math.cos(result.alt * RAD) - up * Math.sin(result.alt * RAD);
    result.az = wrap(anchor.az - Math.atan2(right, along) / RAD);
    return result;
  }
  const from = direction(under.az, under.alt),
    to = direction(anchor.az, anchor.alt);
  const v = cross(from, to),
    cos = clamp(dot(from, to), -1, 1);
  if (cos > 1 - 1e-14) return next;
  // Rodrigues' shortest rotation. Roll is needed to preserve the anchor at the zenith too.
  const rotate = (p: number[]) => {
    const first = cross(v, p),
      second = cross(v, first);
    return p.map((n, i) => n + first[i] + second[i] / Math.max(1e-12, 1 + cos));
  };
  const old = basis(next),
    forward = rotate(old.forward),
    right = rotate(old.right);
  const result: View = {
    ...next,
    az: wrap(Math.atan2(forward[0], forward[1]) / RAD),
    alt: Math.asin(clamp(forward[2], -1, 1)) / RAD,
    roll: 0,
  };
  const upright = basis(result);
  result.roll =
    Math.atan2(dot(right, upright.up), dot(right, upright.right)) / RAD;
  return result;
}

/** Keep the sky point beneath the pointer fixed while changing angular field. */
export function zoomAt(
  view: View,
  fov: number,
  x: number,
  y: number,
  cx: number,
  cy: number,
  r: number,
  aspect = 1,
): View {
  const anchor = unproject(x, y, view, cx, cy, r, false, aspect);
  if (!anchor) return view;
  return anchorDirection(
    {
      ...perspective(view),
      fov: clamp(fov, 0.1, view.mode === "personal" ? 90 : 170),
    },
    anchor,
    x,
    y,
    cx,
    cy,
    r,
    aspect,
  );
}
/** Prepare the camera once for a chart frame rather than once per star. */
export function createProjector(
  view: View,
  cx: number,
  cy: number,
  r: number,
  aspect = 1,
) {
  if (view.mode === "allsky")
    return (az: number, alt: number) => {
      const q = (90 - alt) / 90;
      return {
        x: cx - Math.sin(az * RAD) * q * r,
        y: cy - Math.cos(az * RAD) * q * r,
        inside: q <= 1,
      };
    };
  const { forward, right, up } = basis(view),
    scale = r / Math.tan((view.fov * RAD) / 4);
  return (az: number, alt: number) => {
    const a = az * RAD,
      h = alt * RAD,
      c = Math.cos(h);
    const vx = c * Math.sin(a),
      vy = c * Math.cos(a),
      vz = Math.sin(h);
    const d = vx * forward[0] + vy * forward[1] + vz * forward[2];
    if (d < -0.98) return null;
    const k = scale / (1 + d);
    const x = (vx * right[0] + vy * right[1] + vz * right[2]) * k;
    const y = -(vx * up[0] + vy * up[1] + vz * up[2]) * k;
    const inside =
      view.mode === "personal"
        ? Math.abs(x) <= r * aspect + 1e-7 &&
          Math.abs(y) <= r + 1e-7 &&
          inPersonalSector(az, alt, view.az)
        : x * x + y * y <= r * r;
    return { x: cx + x, y: cy + y, inside };
  };
}
export function project(
  az: number,
  alt: number,
  view: View,
  cx: number,
  cy: number,
  r: number,
  aspect = 1,
) {
  return createProjector(view, cx, cy, r, aspect)(az, alt);
}
export function unproject(
  x: number,
  y: number,
  view: View,
  cx: number,
  cy: number,
  r: number,
  allowOutside = false,
  aspect = 1,
): { az: number; alt: number } | null {
  const dx = (x - cx) / r,
    dy = (y - cy) / r;
  if (
    !allowOutside &&
    (view.mode === "personal"
      ? Math.abs(dx) > aspect || Math.abs(dy) > 1
      : dx * dx + dy * dy > 1)
  )
    return null;
  if (view.mode === "allsky")
    return {
      az: wrap(Math.atan2(-dx, -dy) / RAD),
      alt: 90 - Math.hypot(dx, dy) * 90,
    };
  const a = dx * Math.tan((view.fov * RAD) / 4),
    b = -dy * Math.tan((view.fov * RAD) / 4),
    d = 1 + a * a + b * b;
  const f = (1 - a * a - b * b) / d,
    u = (2 * a) / d,
    v = (2 * b) / d;
  const { forward, right, up } = basis(view);
  const vec = forward.map((n, i) => f * n + u * right[i] + v * up[i]);
  const result = {
    az: wrap(Math.atan2(vec[0], vec[1]) / RAD),
    alt: Math.asin(clamp(vec[2], -1, 1)) / RAD,
  };
  return !allowOutside &&
    view.mode === "personal" &&
    !inPersonalSector(result.az, result.alt, view.az)
    ? null
    : result;
}
export function angularDistance(
  ra1: number,
  dec1: number,
  ra2: number,
  dec2: number,
) {
  return (
    Math.acos(
      clamp(
        Math.sin(dec1 * RAD) * Math.sin(dec2 * RAD) +
          Math.cos(dec1 * RAD) *
            Math.cos(dec2 * RAD) *
            Math.cos((ra1 - ra2) * 15 * RAD),
        -1,
        1,
      ),
    ) / RAD
  );
}
export function moveEquatorial(
  ra: number,
  dec: number,
  toRa: number,
  toDec: number,
  maxDegrees: number,
) {
  const angle = angularDistance(ra, dec, toRa, toDec);
  if (angle <= maxDegrees || angle < 1e-6)
    return { ra: toRa, dec: toDec, arrived: true };
  const p = direction(ra * 15, dec),
    q = direction(toRa * 15, toDec),
    t = maxDegrees / angle,
    omega = angle * RAD;
  if (Math.abs(Math.sin(omega)) < 1e-6)
    return { ra: wrap(ra * 15 + maxDegrees) / 15, dec, arrived: false };
  const v = p.map(
    (x, i) =>
      (Math.sin((1 - t) * omega) * x + Math.sin(t * omega) * q[i]) /
      Math.sin(omega),
  );
  return {
    ra: wrap(Math.atan2(v[0], v[1]) / RAD) / 15,
    dec: Math.asin(clamp(v[2], -1, 1)) / RAD,
    arrived: false,
  };
}
export const formatRA = (ra: number) => {
  const s = Math.round((((ra % 24) + 24) % 24) * 3600);
  return `${String(Math.floor(s / 3600) % 24).padStart(2, "0")}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
};
export const formatDec = (d: number) =>
  `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(2)}°`;

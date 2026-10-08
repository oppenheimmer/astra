import * as S from "satellite.js";
import { clamp, RAD } from "./projection";
import type { EarthFixed, Satellite } from "./types";

/** WGS-72 equatorial radius: the unit SGP4 positions are expressed against. */
export const EARTH_RADIUS_KM = 6378.135;

/** Where the globe is seen from: straight above (lat, lon), north up. */
export interface GlobeCamera {
  lat: number;
  lon: number;
  /** Earth's radius as a fraction of half the chart's shorter side. */
  zoom: number;
}
/** Close enough to read a coastline with the limb still in view, far enough to see the whole geostationary ring. */
export const GLOBE_ZOOM = { min: 0.11, max: 2.5, home: 0.55 };

export const wrapLongitude = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
export const homeCamera = (site: { lat: number; lon: number }): GlobeCamera => ({
  lat: clamp(site.lat, -90, 90),
  lon: wrapLongitude(site.lon),
  zoom: GLOBE_ZOOM.home,
});
export const zoomCamera = (camera: GlobeCamera, factor: number): GlobeCamera => ({
  ...camera,
  zoom: clamp(camera.zoom * factor, GLOBE_ZOOM.min, GLOBE_ZOOM.max),
});
/** Turn the globe under a drag of (dx, dy) pixels; dragging across the disc's radius turns it a radian. */
export function dragCamera(start: GlobeCamera, dx: number, dy: number, radius: number): GlobeCamera {
  // Far out the disc is tiny; a floor keeps a short drag from spinning the planet.
  const degreesPerPixel = 1 / (RAD * Math.max(radius, 120));
  return {
    ...start,
    lon: wrapLongitude(start.lon - dx * degreesPerPixel),
    lat: clamp(start.lat + dy * degreesPerPixel, -90, 90),
  };
}

type Vector = [number, number, number];
export const unitVector = (lat: number, lon: number): Vector => [
  Math.cos(lat * RAD) * Math.cos(lon * RAD),
  Math.cos(lat * RAD) * Math.sin(lon * RAD),
  Math.sin(lat * RAD),
];
/** Geocentric latitude and longitude beneath an Earth-fixed point. */
export const beneath = (p: EarthFixed) => ({
  lat: Math.atan2(p.z, Math.hypot(p.x, p.y)) / RAD,
  lon: Math.atan2(p.y, p.x) / RAD,
});
/** Height above the WGS-72 ellipsoid, in kilometres. */
export const heightAbove = (p: EarthFixed) => S.eciToGeodetic(p, 0).height;

/** One chart frame of the orthographic camera. Positions are in Earth radii. */
export interface GlobeFrame {
  cx: number;
  cy: number;
  /** Pixels per Earth radius. */
  radius: number;
  right: Vector;
  up: Vector;
  /** Towards the viewer. */
  out: Vector;
}
export function globeFrame(camera: GlobeCamera, width: number, height: number): GlobeFrame {
  const lat = camera.lat * RAD,
    lon = camera.lon * RAD;
  return {
    cx: width / 2,
    cy: height / 2,
    radius: (camera.zoom * Math.min(width, height)) / 2,
    right: [-Math.sin(lon), Math.cos(lon), 0],
    up: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    out: unitVector(camera.lat, camera.lon),
  };
}
/** Screen position. `hidden` is true only behind the planet's disc; points beside it stay visible. */
export function projectGlobe(f: GlobeFrame, x: number, y: number, z: number) {
  const u = x * f.right[0] + y * f.right[1] + z * f.right[2],
    v = x * f.up[0] + y * f.up[1] + z * f.up[2],
    depth = x * f.out[0] + y * f.out[1] + z * f.out[2];
  return {
    x: f.cx + u * f.radius,
    y: f.cy - v * f.radius,
    depth,
    hidden: depth < 0 && u * u + v * v < 1,
  };
}

type Sink = Pick<CanvasRenderingContext2D, "moveTo" | "lineTo">;
/** Which side of the planet to trace: 1 the near side, -1 the far side seen through it. */
export type Side = 1 | -1;

/**
 * Trace one side of a polyline of unit vectors on Earth's surface. Segments are
 * cut where they cross the limb, so near and far strokes meet exactly at the edge.
 */
export function traceSurface(sink: Sink, points: Float64Array, f: GlobeFrame, side: Side = 1) {
  let pu = 0, pv = 0, pd = 0, drawing = false;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    const u = x * f.right[0] + y * f.right[1] + z * f.right[2],
      v = x * f.up[0] + y * f.up[1] + z * f.up[2],
      d = side * (x * f.out[0] + y * f.out[1] + z * f.out[2]);
    const shown = d >= 0;
    if (i && shown !== pd >= 0) {
      const t = pd / (pd - d);
      let cu = pu + t * (u - pu), cv = pv + t * (v - pv);
      const length = Math.hypot(cu, cv) || 1;
      cu /= length;
      cv /= length;
      if (shown) sink.moveTo(f.cx + cu * f.radius, f.cy - cv * f.radius);
      else sink.lineTo(f.cx + cu * f.radius, f.cy - cv * f.radius);
      drawing = shown;
    }
    if (shown) {
      if (drawing) sink.lineTo(f.cx + u * f.radius, f.cy - v * f.radius);
      else sink.moveTo(f.cx + u * f.radius, f.cy - v * f.radius);
      drawing = true;
    }
    pu = u;
    pv = v;
    pd = d;
  }
}

/**
 * Trace the parts of a path in space that are visible (side 1) or behind the
 * planet's disc (side -1). Each change is located on its segment by bisection.
 */
export function traceSpace(sink: Sink, points: Float64Array, f: GlobeFrame, side: Side = 1) {
  const shown = (x: number, y: number, z: number) => (projectGlobe(f, x, y, z).hidden ? -1 : 1) === side;
  let drawing = false, px = 0, py = 0, pz = 0;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i], y = points[i + 1], z = points[i + 2];
    const now = shown(x, y, z);
    if (i && now !== drawing) {
      let a = 0, b = 1;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) / 2;
        if (shown(px + m * (x - px), py + m * (y - py), pz + m * (z - pz)) === drawing) a = m;
        else b = m;
      }
      const t = (a + b) / 2,
        q = projectGlobe(f, px + t * (x - px), py + t * (y - py), pz + t * (z - pz));
      if (now) sink.moveTo(q.x, q.y);
      else sink.lineTo(q.x, q.y);
    }
    const p = projectGlobe(f, x, y, z);
    // After the first point, a shown point always continues a stroke: either
    // the previous one or the one just begun at the crossing.
    if (now) {
      if (i) sink.lineTo(p.x, p.y);
      else sink.moveTo(p.x, p.y);
    }
    drawing = now;
    px = x;
    py = y;
    pz = z;
  }
}

/** Unit vectors for a line of [lat, lon] points on the surface. */
export function surfaceLine(points: [number, number][]) {
  const out = new Float64Array(points.length * 3);
  points.forEach(([lat, lon], i) => out.set(unitVector(lat, lon), i * 3));
  return out;
}
let graticule: { parallels: Float64Array[]; meridians: Float64Array[]; equator: Float64Array } | null = null;
/** Parallels and meridians every 15°, the equator kept apart so it can be drawn heavier. */
export function globeGraticule() {
  if (graticule) return graticule;
  const around = (lat: number) => surfaceLine(Array.from({ length: 181 }, (_, i) => [lat, -180 + i * 2]));
  const parallels = [];
  for (let lat = -75; lat <= 75; lat += 15) if (lat) parallels.push(around(lat));
  const meridians = [];
  for (let lon = -180; lon < 180; lon += 15)
    meridians.push(surfaceLine(Array.from({ length: 91 }, (_, i) => [-90 + i * 2, lon])));
  graticule = { parallels, meridians, equator: around(0) };
  return graticule;
}

/** One revolution in the inertial (TEME) frame, in Earth radii, centred on `time`. */
export function inertialOrbit(sat: Satellite, time: number, samples = 360): Float64Array | null {
  const period = (1440 / sat.elements.MEAN_MOTION) * 60000;
  const out = new Float64Array((samples + 1) * 3);
  for (let i = 0; i <= samples; i++) {
    try {
      const pv = S.propagate(sat.record, new Date(time + (i / samples - 0.5) * period));
      if (!pv?.position || typeof pv.position === "boolean") return null;
      out[i * 3] = pv.position.x / EARTH_RADIUS_KM;
      out[i * 3 + 1] = pv.position.y / EARTH_RADIUS_KM;
      out[i * 3 + 2] = pv.position.z / EARTH_RADIUS_KM;
    } catch {
      return null;
    }
  }
  return out;
}
/** The inertial orbit as it lies over the turning Earth at one instant (GMST in radians). */
export function earthFixedOrbit(path: Float64Array, gmst: number) {
  const out = new Float64Array(path.length),
    c = Math.cos(gmst),
    s = Math.sin(gmst);
  for (let i = 0; i < path.length; i += 3) {
    out[i] = path[i] * c + path[i + 1] * s;
    out[i + 1] = -path[i] * s + path[i + 1] * c;
    out[i + 2] = path[i + 2];
  }
  return out;
}

export type OrbitClass = "station" | "radio" | "starlink" | "leo" | "meo" | "geo" | "heo";
export const ORBIT_CLASSES: OrbitClass[] = ["station", "radio", "leo", "starlink", "meo", "geo", "heo"];
export const orbitLabels: Record<OrbitClass, string> = {
  station: "Space stations",
  radio: "Radio / SatNOGS",
  leo: "Low Earth orbit",
  starlink: "Starlink",
  meo: "Medium Earth orbit",
  geo: "Geosynchronous",
  heo: "Highly elliptical",
};
const classes = new WeakMap<Satellite, OrbitClass>();
/**
 * Regime by period and shape: low orbits complete a revolution in under 128
 * minutes, geosynchronous ones in about a sidereal day. Station modules and the
 * Starlink shell are split out because they dominate how the sky looks, and
 * satellites SatNOGS DB lists with a live transmitter because an observer can
 * listen for them.
 */
export function orbitClass(sat: Satellite): OrbitClass {
  let value = classes.get(sat);
  if (value) return value;
  const { MEAN_MOTION: motion, ECCENTRICITY: eccentricity } = sat.elements;
  value = /^(ISS|CSS) \(/.test(sat.name)
    ? "station"
    : sat.satnogs?.transmitters
      ? "radio"
      : /^STARLINK-/.test(sat.name)
      ? "starlink"
      : eccentricity > 0.25
        ? "heo"
        : motion > 11.25
          ? "leo"
          : motion > 0.9 && motion < 1.1
            ? "geo"
            : "meo";
  classes.set(sat, value);
  return value;
}

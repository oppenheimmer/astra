import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gstime } from "satellite.js";
import { describe, expect, it } from "vitest";
import {
  dragCamera,
  earthFixedOrbit,
  EARTH_RADIUS_KM,
  globeFrame,
  GLOBE_ZOOM,
  heightAbove,
  homeCamera,
  inertialOrbit,
  orbitClass,
  projectGlobe,
  sightLine,
  traceSpace,
  traceSurface,
  unitVector,
  zoomCamera,
} from "../src/globe";
import { globeCoastlines } from "../src/globe-coastlines";
import { hitGlobe } from "../src/useGlobePointer";
import { createSky, prepareSatellites } from "../src/sky";
import type { Catalogue, OrbitalElements, SkyObject } from "../src/types";

const fixture = JSON.parse(readFileSync(join(process.cwd(), "public/data/satellites.json"), "utf8"));
const satellites = prepareSatellites(fixture);
const byNorad = (id: number) => satellites.find((s) => s.elements.NORAD_CAT_ID === id)!;
const time = new Date("2026-09-05T21:00:00Z");
const site = { name: "Greenwich", lat: 51.4779, lon: -0.0015, elevation: 46 };
const empty: Catalogue = { stars: [], messier: { features: [] }, lines: { features: [] }, constellations: { features: [] } };

/** Record a path's pen moves instead of drawing them. */
function recorder() {
  const moves: { pen: "move" | "line"; x: number; y: number }[] = [];
  return {
    moves,
    moveTo: (x: number, y: number) => void moves.push({ pen: "move", x, y }),
    lineTo: (x: number, y: number) => void moves.push({ pen: "line", x, y }),
  };
}

describe("Globe camera", () => {
  const frame = globeFrame({ lat: 0, lon: 0, zoom: 0.5 }, 800, 600);

  it("looks straight down on its centre, north up and east right", () => {
    expect(frame.radius).toBe(150);
    const centre = projectGlobe(frame, ...unitVector(0, 0));
    expect(centre).toMatchObject({ x: 400, y: 300, hidden: false });
    expect(centre.depth).toBeCloseTo(1);
    const north = projectGlobe(frame, ...unitVector(45, 0)),
      east = projectGlobe(frame, ...unitVector(0, 45));
    expect(north.y).toBeLessThan(300);
    expect(north.x).toBeCloseTo(400);
    expect(east.x).toBeGreaterThan(400);
    expect(east.y).toBeCloseTo(300);
  });

  it("hides points behind the disc but not ones beside it", () => {
    expect(projectGlobe(frame, -1, 0, 0).hidden).toBe(true);
    // Geostationary distance, directly behind the planet's edge: visible beside the limb.
    expect(projectGlobe(frame, -1, 6.6, 0).hidden).toBe(false);
    expect(projectGlobe(frame, -6.6, 0.5, 0).hidden).toBe(true);
  });

  it("turns with a drag, wraps longitude and stops at the poles", () => {
    const start = homeCamera({ lat: 10, lon: 175 });
    expect(start.zoom).toBe(GLOBE_ZOOM.home);
    const right = dragCamera(start, 100, 0, 200);
    expect(right.lon).toBeLessThan(175);
    const west = dragCamera(start, -200 * Math.PI / 18, 0, 200);
    expect(west.lon).toBeCloseTo(-175);
    expect(dragCamera(start, 0, 10000, 200).lat).toBe(90);
    // Tiny distant globes still turn at a usable rate.
    expect(Math.abs(dragCamera(start, 10, 0, 5).lon - start.lon)).toBeLessThan(5);
  });

  it("zooms within its limits", () => {
    const start = homeCamera(site);
    expect(zoomCamera(start, 100).zoom).toBe(GLOBE_ZOOM.max);
    expect(zoomCamera(start, 0.001).zoom).toBe(GLOBE_ZOOM.min);
  });
});

describe("Wireframe tracing", () => {
  const frame = globeFrame({ lat: 0, lon: 0, zoom: 0.5 }, 800, 600);
  const equator = new Float64Array(Array.from({ length: 181 }, (_, i) => unitVector(0, -180 + i * 2)).flat());

  it("cuts surface lines exactly at the limb, on both sides", () => {
    for (const side of [1, -1] as const) {
      const path = recorder();
      traceSurface(path, equator, frame, side);
      expect(path.moves.length).toBeGreaterThan(0);
      for (const m of path.moves) expect(Math.abs(m.x - 400)).toBeLessThanOrEqual(150 + 1e-9);
      // The near side runs limb to limb through the centre in one stroke.
      if (side === 1) {
        expect(path.moves.filter((m) => m.pen === "move")).toHaveLength(1);
        expect(path.moves[0].x).toBeCloseTo(250);
        expect(path.moves.at(-1)!.x).toBeCloseTo(550);
      }
    }
  });

  it("splits a path in space where it passes behind the planet", () => {
    // A circle in the plane of view at twice Earth's radius: never hidden.
    const ring = new Float64Array(Array.from({ length: 73 }, (_, i) => [0, 2 * Math.cos(i * Math.PI / 36), 2 * Math.sin(i * Math.PI / 36)]).flat());
    const near = recorder(), far = recorder();
    traceSpace(near, ring, frame, 1);
    traceSpace(far, ring, frame, -1);
    expect(near.moves.filter((m) => m.pen === "move")).toHaveLength(1);
    expect(far.moves).toHaveLength(0);
    // Tilted through the planet: its far half is partly hidden behind the disc.
    const tilted = new Float64Array(Array.from({ length: 73 }, (_, i) => [2 * Math.cos(i * Math.PI / 36), 2 * Math.sin(i * Math.PI / 36), 0]).flat());
    const front = recorder(), back = recorder();
    traceSpace(front, tilted, frame, 1);
    traceSpace(back, tilted, frame, -1);
    expect(back.moves.length).toBeGreaterThan(0);
    for (const m of back.moves) expect(Math.hypot(m.x - 400, m.y - 300)).toBeLessThanOrEqual(150 + 1);
  });

  it("recovers Natural Earth outlines as unit vectors", () => {
    const rings = globeCoastlines();
    expect(rings.length).toBeGreaterThan(100);
    for (const ring of rings)
      for (let i = 0; i < ring.length; i += 3)
        expect(Math.hypot(ring[i], ring[i + 1], ring[i + 2])).toBeCloseTo(1, 9);
    // Greenwich lies on land, close to an outline vertex of Great Britain.
    const here = unitVector(site.lat, site.lon);
    const nearest = Math.min(...rings.flatMap((ring) =>
      Array.from({ length: ring.length / 3 }, (_, i) =>
        Math.hypot(ring[i * 3] - here[0], ring[i * 3 + 1] - here[1], ring[i * 3 + 2] - here[2]))));
    expect(nearest * EARTH_RADIUS_KM).toBeLessThan(150);
  });
});

describe("Satellites on the globe", () => {
  const sky = createSky(empty, satellites, time, site);
  const iss = sky.objects.find((o) => o.satellite?.elements.NORAD_CAT_ID === 25544)!;

  it("carries Earth-fixed positions from the same SGP4 step as the sky chart", () => {
    expect(iss.ecf).toBeDefined();
    const radius = Math.hypot(iss.ecf!.x, iss.ecf!.y, iss.ecf!.z);
    expect(radius - EARTH_RADIUS_KM).toBeGreaterThan(350);
    expect(radius - EARTH_RADIUS_KM).toBeLessThan(450);
    expect(heightAbove(iss.ecf!)).toBeCloseTo(iss.height!, 0);
  });

  it("draws each satellite on its own orbit", () => {
    const path = earthFixedOrbit(inertialOrbit(iss.satellite!, time.getTime())!, gstime(time));
    const p = [iss.ecf!.x, iss.ecf!.y, iss.ecf!.z].map((n) => n / EARTH_RADIUS_KM);
    let nearest = Infinity;
    for (let i = 0; i < path.length; i += 3)
      nearest = Math.min(nearest, Math.hypot(path[i] - p[0], path[i + 1] - p[1], path[i + 2] - p[2]));
    // One sample per degree of a low orbit is about 120 km apart.
    expect(nearest * EARTH_RADIUS_KM).toBeLessThan(70);
    // A single revolution closes on itself.
    const end = path.length - 3;
    expect(Math.hypot(path[0] - path[end], path[1] - path[end + 1], path[2] - path[end + 2]) * EARTH_RADIUS_KM).toBeLessThan(100);
  });

  it("draws a line of sight only above the horizon and with both ends facing the viewer", () => {
    const above = { x: 0, y: 0, z: EARTH_RADIUS_KM + 700 };
    const north = globeFrame({ lat: 90, lon: 0, zoom: 0.5 }, 800, 600);
    // An observer at the pole with a satellite overhead.
    const line = sightLine(north, { lat: 90, lon: 0 }, above, 90)!;
    expect(line).toBeInstanceOf(Float64Array);
    expect(Array.from(line.slice(0, 3)).map((n) => +n.toFixed(9))).toEqual([0, 0, 1]);
    expect(line.at(-1)).toBeCloseTo((EARTH_RADIUS_KM + 700) / EARTH_RADIUS_KM);
    expect(sightLine(north, { lat: 90, lon: 0 }, above, -5)).toBeNull();
    // Seen from over the south pole, observer and satellite are both on the far side.
    const south = globeFrame({ lat: -90, lon: 0, zoom: 0.5 }, 800, 600);
    expect(sightLine(south, { lat: 90, lon: 0 }, above, 90)).toBeNull();
    // From the equator the observer sits on the limb, still facing the viewer; the satellite beside it is visible.
    const side = globeFrame({ lat: 0, lon: 0, zoom: 0.5 }, 800, 600);
    expect(sightLine(side, { lat: 90, lon: 0 }, above, 90)).not.toBeNull();
    // An observer on the far side gets no line, even with the satellite in view beyond the limb.
    expect(sightLine(side, { lat: 0, lon: 180 }, { x: -2 * EARTH_RADIUS_KM, y: 2 * EARTH_RADIUS_KM, z: 0 }, 30)).toBeNull();
  });

  it("classifies orbits by regime, with stations and Starlink split out", () => {
    const fake = (name: string, motion: number, eccentricity = 0.001) =>
      ({ ...satellites[0], name, elements: { ...satellites[0].elements, MEAN_MOTION: motion, ECCENTRICITY: eccentricity } as OrbitalElements });
    expect(orbitClass(byNorad(25544))).toBe("station");
    expect(orbitClass(byNorad(20580))).toBe("leo");
    expect(orbitClass(fake("STARLINK-1007", 15.06))).toBe("starlink");
    expect(orbitClass(fake("GPS BIIF-1", 2.005))).toBe("meo");
    expect(orbitClass(fake("GOES 19", 1.0027))).toBe("geo");
    expect(orbitClass(fake("MOLNIYA 1-93", 2.006, 0.7))).toBe("heo");
  });

  it("picks the nearest drawn satellite and ignores undrawn ones", () => {
    const objects = [iss, { ...iss, id: "b" }, { ...iss, id: "c" }] as SkyObject[];
    const hits = { objects, xs: new Float32Array([10, 30, NaN]), ys: new Float32Array([10, 10, NaN]) };
    expect(hitGlobe(hits, 26, 10, 12)?.id).toBe("b");
    expect(hitGlobe(hits, 13, 10, 12)?.id).toBe(iss.id);
    expect(hitGlobe(hits, 100, 100, 12)).toBeNull();
    expect(hitGlobe(null, 10, 10, 12)).toBeNull();
  });
});

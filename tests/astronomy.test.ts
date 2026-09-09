import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as A from "astronomy-engine";
import {
  angularDistance,
  moveEquatorial,
  project,
  unproject,
} from "../src/projection";
import {
  createSky,
  equatorialToHorizontal,
  horizontalToEquatorial,
  prepareSatellites,
  satellitePosition,
} from "../src/sky";
import { advanceTelescope, stopTelescope } from "../src/simulator";
import type { Catalogue, Site, Telescope, View } from "../src/types";

const load = (name: string) =>
  JSON.parse(
    readFileSync(new URL("../public/data/" + name, import.meta.url), "utf8"),
  );
const catalogue: Catalogue = {
  stars: load("stars.json"),
  messier: load("messier.json"),
  lines: load("constellations.lines.json"),
  constellations: load("constellations.json"),
};
const site: Site = {
  name: "Greenwich",
  lat: 51.4779,
  lon: -0.0015,
  elevation: 46,
};
const date = new Date("2026-09-05T22:00:00Z");
const satelliteData = load("satellites.json");
const satellites = prepareSatellites(satelliteData);

describe("Sky coordinates and catalogue", () => {
  it("gives Sun and Moon realistic angular diameters that follow observer distance", () => {
    const minimal: Catalogue = { ...catalogue, stars: [] };
    const winter = createSky(
      minimal,
      [],
      new Date("2026-01-03T12:00:00Z"),
      site,
    );
    const summer = createSky(
      minimal,
      [],
      new Date("2026-07-04T12:00:00Z"),
      site,
    );
    for (const sky of [winter, summer]) {
      const sun = sky.byId.get("Sun")!,
        moon = sky.byId.get("Moon")!;
      expect(sun.angularDiameter! * 60).toBeGreaterThan(31);
      expect(sun.angularDiameter! * 60).toBeLessThan(33);
      expect(moon.angularDiameter! * 60).toBeGreaterThan(29);
      expect(moon.angularDiameter! * 60).toBeLessThan(35);
      expect(sky.byId.get("Mars")!.angularDiameter).toBeUndefined();
    }
    expect(winter.byId.get("Sun")!.angularDiameter!).toBeGreaterThan(
      summer.byId.get("Sun")!.angularDiameter!,
    );
    expect(winter.byId.get("Moon")!.angularDiameter).not.toBe(
      summer.byId.get("Moon")!.angularDiameter,
    );
  });
  it("matches independent equator-of-date Horizon calculations for planets, Moon and Sun", () => {
    for (const site of [
      { name: "Sydney", lat: -33.87, lon: 151.21, elevation: 58 },
      { name: "Arctic", lat: 80, lon: 20, elevation: 0 },
    ]) {
      for (const body of [
        A.Body.Moon,
        A.Body.Jupiter,
        A.Body.Sun,
        A.Body.Saturn,
      ]) {
        const obs = new A.Observer(site.lat, site.lon, site.elevation);
        const j2000 = A.Equator(body, date, obs, false, true);
        const ofDate = A.Equator(body, date, obs, true, true);
        const expected = A.Horizon(date, obs, ofDate.ra, ofDate.dec);
        const got = equatorialToHorizontal(j2000.ra, j2000.dec, date, site);
        expect(got.alt).toBeCloseTo(expected.altitude, 6);
        expect(got.az).toBeCloseTo(expected.azimuth, 6);
      }
    }
  });
  it("round-trips arbitrary aiming directions through celestial coordinates", () => {
    for (const [az, alt] of [
      [0, 0],
      [359, 85],
      [180, 45],
      [20, -10],
    ]) {
      const eq = horizontalToEquatorial(az, alt, date, site);
      const h = equatorialToHorizontal(eq.ra, eq.dec, date, site);
      expect(h.az === 360 ? 0 : h.az).toBeCloseTo(az, 6);
      expect(h.alt).toBeCloseTo(alt, 6);
    }
  });
  it("classifies galaxies correctly and gives finite locations across the full catalogue", () => {
    const sky = createSky(catalogue, satellites, date, site);
    expect(sky.byId.get("M31")?.kind).toBe("galaxy");
    expect(sky.byId.get("M87")?.kind).toBe("galaxy");
    expect(sky.byId.get("M13")?.kind).toBe("cluster");
    expect(sky.byId.get("M42")?.kind).toBe("nebula");
    for (const o of sky.objects) {
      expect(Number.isFinite(o.az) && Number.isFinite(o.alt), o.name).toBe(
        true,
      );
      expect(o.az).toBeGreaterThanOrEqual(0);
      expect(o.az).toBeLessThan(360);
    }
    expect(catalogue.stars.find((s) => s.name === "Vega")?.dist).toBeCloseTo(
      25.05,
      0,
    );
  });
  it("predicts a plausible ISS position at its epoch and hides unsupported historical predictions", () => {
    const iss = satellites.find((s) => s.name.includes("ISS"))!;
    expect(iss).toBeTruthy();
    const epoch = new Date(iss.epoch + (iss.epoch.endsWith("Z") ? "" : "Z"));
    const position = satellitePosition(iss, epoch, site)!;
    expect(position.height).toBeGreaterThan(250);
    expect(position.height).toBeLessThan(600);
    expect(position.velocity).toBeGreaterThan(7);
    expect(position.velocity).toBeLessThan(9);
    const old = createSky(
      catalogue,
      [iss],
      new Date(epoch.getTime() - 16 * 86400000),
      site,
    );
    expect(old.objects.some((o) => o.kind === "satellite")).toBe(false);
  });
});

describe("Projection and simulated motors", () => {
  it("keeps map aiming and plotted positions consistent at different zooms", () => {
    for (const view of [
      { mode: "horizon", az: 185, alt: 40, fov: 110 },
      { mode: "horizon", az: 2, alt: 80, fov: 0.5 },
      { mode: "allsky", az: 0, alt: 90, fov: 180 },
    ] as View[]) {
      for (const [x, y] of [
        [400, 350],
        [350, 300],
        [470, 500],
      ]) {
        const h = unproject(x, y, view, 400, 350, 300)!;
        const p = project(h.az, h.alt, view, 400, 350, 300)!;
        expect(p.x).toBeCloseTo(x, 6);
        expect(p.y).toBeCloseTo(y, 6);
      }
    }
  });
  it("takes the short slew across 24h/0h and honours motor speed", () => {
    const moved = moveEquatorial(23.9, 20, 0.1, 20, 1);
    expect(angularDistance(23.9, 20, moved.ra, moved.dec)).toBeCloseTo(1, 6);
    expect(angularDistance(moved.ra, moved.dec, 0.1, 20)).toBeLessThan(2);
    expect(moved.arrived).toBe(false);
    const finish = moveEquatorial(moved.ra, moved.dec, 0.1, 20, 10);
    expect(finish).toEqual({ ra: 0.1, dec: 20, arrived: true });
  });
  it("stops both slew and tracking, holding the physical direction as time advances", () => {
    const sky = createSky(catalogue, [], date, site);
    const tel: Telescope = {
      connected: true,
      ra: 18,
      dec: 40,
      targetRa: 20,
      targetDec: 20,
      targetId: null,
      moving: true,
      tracking: true,
      shape: "circle",
      width: 0.625,
      height: 0.625,
    };
    const step = advanceTelescope(tel, 0.5, sky);
    expect(angularDistance(tel.ra, tel.dec, step.ra, step.dec)).toBeCloseTo(
      1,
      6,
    );
    const stopped = stopTelescope(step, sky);
    const later = { ...sky, time: new Date(date.getTime() + 3600000) };
    const held = advanceTelescope(stopped, 1, later);
    const h = equatorialToHorizontal(held.ra, held.dec, later.time, site);
    expect(h.az).toBeCloseTo(stopped.holdAz!, 6);
    expect(h.alt).toBeCloseTo(stopped.holdAlt!, 6);
    expect(held.moving).toBe(false);
    expect(held.tracking).toBe(false);
  });
});

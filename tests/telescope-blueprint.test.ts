import { describe, expect, it } from "vitest";
import { mountAngles } from "../src/TelescopeBlueprint";
import { createSky } from "../src/sky";
import { advanceTelescope, stopTelescope } from "../src/simulator";
import type { Catalogue, Telescope } from "../src/types";

const catalogue: Catalogue = { stars: [], messier: { features: [] }, lines: { features: [] }, constellations: { features: [] } };
const site = { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 };
const date = new Date("2026-09-06T20:00:00Z");
const telescope: Telescope = { connected: true, ra: 18, dec: 38, targetRa: 20, targetDec: 10, targetId: null,
  moving: false, tracking: true, shape: "circle", width: .625, height: .625 };

describe("Mount drawing follows the simulated axes", () => {
  it("moves the RA axis under tracking, and holds both axes with motors off", () => {
    const later = new Date(date.getTime() + 60000);
    const start = mountAngles(telescope, date, site), tracked = mountAngles(telescope, later, site);
    expect(tracked.ra - start.ra).toBeCloseTo(.2507, 3);
    const stopped = stopTelescope(telescope, createSky(catalogue, [], date, site));
    const held = advanceTelescope(stopped, 60, createSky(catalogue, [], later, site));
    const end = mountAngles(held, later, site);
    expect(end.ra).toBeCloseTo(start.ra, 4);
    expect(end.dec).toBeCloseTo(start.dec, 4);
  });
  it("changes both motor angles during a slew without inventing decorative rotation", () => {
    const start = mountAngles(telescope, date, site);
    const slewed = advanceTelescope({ ...telescope, moving: true }, 2, createSky(catalogue, [], date, site));
    const end = mountAngles(slewed, date, site);
    expect(Math.abs(end.ra - start.ra)).toBeGreaterThan(1);
    expect(Math.abs(end.dec - start.dec)).toBeGreaterThan(1);
  });
});

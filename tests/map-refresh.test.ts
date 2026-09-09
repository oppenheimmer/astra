import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createSky,
  equatorialToHorizontal,
  horizontalToEquatorial,
  prepareSatellites,
} from "../src/sky";
import { starPosition } from "../src/star-catalogue";
import { angularDistance } from "../src/projection";
import type { Catalogue, Star } from "../src/types";

const star: Star = {
  id: "fast",
  hip: "",
  name: "High proper motion fixture",
  named: false,
  ra: 18,
  dec: 38,
  mag: 9,
  dist: null,
  spec: "",
  con: "",
  lum: null,
  ci: null,
  pmra: 10000,
  pmdec: 10000,
  x: 0,
  y: 0,
  z: 0,
  epoch: 2016,
};
const catalogue: Catalogue = {
  stars: [star],
  messier: { features: [] },
  lines: { features: [] },
  constellations: { features: [] },
};
const site = { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 };
const time = Date.parse("2026-09-06T20:00:00Z");
const satellites = prepareSatellites(
  JSON.parse(
    readFileSync(
      new URL("../public/data/satellites.json", import.meta.url),
      "utf8",
    ),
  ),
).slice(0, 3);

describe("Fast sky refresh", () => {
  it("advances horizontal positions on 100 ms ticks without mutating earlier frames", () => {
    const first = createSky(catalogue, satellites, new Date(time), site);
    const initial = first.byId.get(star.id)!;
    const altitude = initial.alt;
    const next = createSky(
      catalogue,
      satellites,
      new Date(time + 100),
      site,
    ).byId.get(star.id)!;
    expect(next.alt).not.toBe(initial.alt);
    expect(next.ra).toBe(initial.ra);
    expect(initial.alt).toBe(altitude);
    expect(next).not.toBe(initial);
  });
  it("retains coordinate accuracy across minute boundaries, year changes and locations", () => {
    for (const offset of [59900, 60100, 86400000 * 365])
      for (const lat of [46.948, -33.8, 89]) {
        const date = new Date(time + offset),
          place = { ...site, lat };
        const sky = createSky(catalogue, satellites, date, place);
        const year =
          2000 +
          (date.getTime() - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000);
        const pos = starPosition(star, year),
          expected = equatorialToHorizontal(pos.ra, pos.dec, date, place);
        const actual = sky.byId.get(star.id)!;
        // Quantising proper motion to a minute remains much smaller than an arcsecond.
        expect(Math.abs(actual.alt - expected.alt)).toBeLessThan(0.000001);
        expect(Math.abs(actual.az - expected.az)).toBeLessThan(0.000001);
        for (const object of sky.objects.filter(
          (o) => o.kind === "satellite",
        )) {
          const equatorial = horizontalToEquatorial(
            object.az,
            object.alt,
            date,
            place,
          );
          expect(
            angularDistance(
              object.ra,
              object.dec,
              equatorial.ra,
              equatorial.dec,
            ),
          ).toBeLessThan(0.000002);
        }
      }
  });
});

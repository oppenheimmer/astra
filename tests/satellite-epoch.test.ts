import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createSky,
  epochAgeDays,
  prepareSatellites,
  SATELLITE_MAX_DAYS,
  SATELLITE_STALE_DAYS,
} from "../src/sky";
import type { Catalogue, SatelliteData } from "../src/types";

const visual: SatelliteData = JSON.parse(
  readFileSync(join(process.cwd(), "public/data/satellites.json"), "utf8"),
);
const catalogue: Catalogue = {
  stars: [], messier: { features: [] }, lines: { features: [] }, constellations: { features: [] },
};
const site = { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 };

/** One real element set, so SGP4 initialisation behaves as it does in the app. */
const one = prepareSatellites({ ...visual, elements: visual.elements.slice(0, 1) });
const epoch = Date.parse(
  one[0].epoch.endsWith("Z") ? one[0].epoch : one[0].epoch + "Z",
);
const at = (days: number) => new Date(epoch + days * 86400000);
const plotted = (days: number) =>
  createSky(catalogue, one, at(days), site).objects.filter((o) => o.kind === "satellite");

describe("Orbital element age", () => {
  it("measures the gap to the epoch in both directions and survives a bad timestamp", () => {
    expect(epochAgeDays(one[0].epoch, at(0))).toBeCloseTo(0, 6);
    expect(epochAgeDays(one[0].epoch, at(2))).toBeCloseTo(2, 6);
    expect(epochAgeDays(one[0].epoch, at(-2))).toBeCloseTo(2, 6);
    expect(epochAgeDays("not a date", at(0))).toBe(Infinity);
    // The feed omits the zone marker; treating it as local time would shift the age.
    expect(epochAgeDays(one[0].epoch.replace(/Z$/, ""), at(0))).toBeCloseTo(0, 6);
  });

  it("draws elements inside the window and refuses to guess a position outside it", () => {
    expect(plotted(0)).toHaveLength(1);
    expect(plotted(SATELLITE_MAX_DAYS - 0.01)).toHaveLength(1);
    expect(plotted(SATELLITE_MAX_DAYS + 0.01)).toHaveLength(0);
    expect(plotted(-(SATELLITE_MAX_DAYS + 0.01))).toHaveLength(0);
    expect(plotted(30)).toHaveLength(0);
  });

  it("flags predictions that are old but still drawable", () => {
    expect(plotted(SATELLITE_STALE_DAYS - 0.01)[0].stale).toBe(false);
    expect(plotted(SATELLITE_STALE_DAYS + 0.01)[0].stale).toBe(true);
    expect(plotted(-(SATELLITE_STALE_DAYS + 0.01))[0].stale).toBe(true);
  });

  it("keeps the flag strictly inside the window it is meant to warn about", () => {
    expect(SATELLITE_STALE_DAYS).toBeLessThan(SATELLITE_MAX_DAYS);
    expect(SATELLITE_MAX_DAYS).toBeLessThanOrEqual(3);
  });

  it("hides the whole catalogue once a refresh has been missed for too long", () => {
    const all = prepareSatellites(visual);
    expect(createSky(catalogue, all, at(0), site).objects.some((o) => o.kind === "satellite")).toBe(true);
    const stale = createSky(catalogue, all, new Date(epoch + 40 * 86400000), site);
    expect(stale.objects.some((o) => o.kind === "satellite")).toBe(false);
  });
});

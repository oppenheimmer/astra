import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createSky, prepareSatellites, satellitePosition } from "../src/sky";
import { describeSatellite } from "../src/satellite-info";
import type { Catalogue, SatelliteData } from "../src/types";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), "utf8"));
const visual: SatelliteData = load("satellites.json"), active: SatelliteData = load("active.json");
const starlink: SatelliteData = { ...active, elements: active.elements.filter(e => /^STARLINK-\d+$/.test(e.OBJECT_NAME)) };
// Propagate at the snapshot's download time, so no element is past the epoch limit.
const snapshotDate = new Date(active.fetchedAt);

describe("Starlink in the default satellite catalogue", () => {
  it("merges the feeds once per NORAD ID and identifies communications payloads", () => {
    const all = prepareSatellites({ ...visual, elements: [...visual.elements, ...starlink.elements, starlink.elements[0]] });
    expect(all.length).toBe(new Set([...visual.elements, ...starlink.elements].map(e => e.NORAD_CAT_ID)).size);
    const selected = all.find(s => s.name === "STARLINK-1008")!;
    expect(describeSatellite(selected).label).toContain("Starlink");
    expect(selected.metadata?.objectType).toBe("PAY");
    expect(selected.metadata?.launchDate).toBe("");
  });
  it("places Starlinks above the observer's horizon as ordinary satellites", () => {
    const all = prepareSatellites(starlink);
    const catalogue: Catalogue = { stars: [], messier: { features: [] }, lines: { features: [] }, constellations: { features: [] } };
    const sky = createSky(catalogue, all, snapshotDate, { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 });
    const above = sky.objects.filter(o => o.kind === "satellite" && o.alt > 0);
    expect(above.length).toBeGreaterThan(100);
    expect(above.every(o => o.name.startsWith("STARLINK") && Number.isFinite(o.az))).toBe(true);
    expect(above.some(o => o.sunlit)).toBe(true);
  });
  it("retains exact look angles when the map skips unselected geographic details", () => {
    const sample = prepareSatellites(starlink).filter((_, i) => i % 1000 === 0);
    const catalogue: Catalogue = { stars: [], messier: { features: [] }, lines: { features: [] }, constellations: { features: [] } };
    const date = new Date(snapshotDate.getTime() + 100), site = { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 };
    const fast = createSky(catalogue, sample, date, site, false);
    for (const sat of sample) {
      const exact = satellitePosition(sat, date, site), actual = fast.byId.get(sat.id);
      if (!exact) continue;
      expect(actual?.alt).toBeCloseTo(exact.alt, 8);
      expect(actual?.az).toBeCloseTo(exact.az, 8);
      expect(actual?.range).toBeCloseTo(exact.range, 7);
      expect(actual?.sunlit).toBe(exact.sunlit);
      expect(actual?.height).toBeUndefined();
      expect(Number.isFinite(exact.height)).toBe(true);
    }
  });
});

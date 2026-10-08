import { describe, expect, it } from "vitest";
import { craftPosition, earthFixedAt, moonOrbit, moonPosition, parseDeepSpace, sunPosition } from "../src/deep-space";
import { orbitClass } from "../src/globe";
import { describeSatellite } from "../src/satellite-info";
import { prepareSatellites } from "../src/sky";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeepSpaceData, OrbitalElements } from "../src/types";

const data: DeepSpaceData = {
  fetchedAt: "2026-10-08T15:00:00Z", source: "JPL Horizons", start: "2026-10-05T15:00:00Z",
  step: 3 * 3600000, count: 3,
  craft: [{ id: "-170", name: "James Webb", region: "L2", positions: [1e6, 0, 0, 1.1e6, 3e5, 0, 1.2e6, 6e5, 9e4] }],
};
const start = Date.parse(data.start);
const length = (v: number[]) => Math.hypot(...v);

describe("Deep-space craft", () => {
  it("accepts the published samples and rejects malformed ones", () => {
    expect(parseDeepSpace(data)).toEqual(data);
    const craft = data.craft[0];
    for (const bad of [
      { ...data, count: 4 },
      { ...data, step: 0 },
      { ...data, start: "soon" },
      { ...data, craft: [{ ...craft, region: "L4" }] },
      { ...data, craft: [{ ...craft, name: "" }] },
      { ...data, craft: [{ ...craft, positions: [...craft.positions.slice(1), Number.NaN] }] },
      { ...data, craft: "James Webb" },
      null,
    ]) expect(parseDeepSpace(bad)).toBeNull();
  });

  it("interpolates between samples and hides a craft outside the sampled window", () => {
    expect(craftPosition(data, 0, start)).toEqual([1e6, 0, 0]);
    expect(craftPosition(data, 0, start + 1.5 * 3600000)).toEqual([1.05e6, 1.5e5, 0]);
    expect(craftPosition(data, 0, start + 6 * 3600000)).toEqual([1.2e6, 6e5, 9e4]);
    expect(craftPosition(data, 0, start - 1)).toBeNull();
    expect(craftPosition(data, 0, start + 6 * 3600000 + 1)).toBeNull();
  });

  it("turns J2000 vectors into the Earth-fixed frame without changing their length", () => {
    const time = new Date("2026-10-08T19:00:00Z");
    const toFixed = earthFixedAt(time);
    const v: [number, number, number] = [1.2e6, -4e5, 3e5];
    expect(length(toFixed(v))).toBeCloseTo(length(v), 3);
    // Earth turns once a sidereal day: the same inertial direction drifts by about 15° an hour.
    const later = earthFixedAt(new Date(time.getTime() + 3600000))(v), now = toFixed(v);
    const angle = Math.acos((now[0] * later[0] + now[1] * later[1]) / (Math.hypot(now[0], now[1]) * Math.hypot(later[0], later[1])));
    expect(angle * 180 / Math.PI).toBeCloseTo(15.04, 1);
  });

  it("places the Moon and Sun at their real distances", () => {
    const time = new Date("2026-10-08T19:00:00Z");
    expect(length(moonPosition(time))).toBeGreaterThan(356000);
    expect(length(moonPosition(time))).toBeLessThan(407000);
    expect(length(sunPosition(time)) / 149597870.7).toBeCloseTo(1, 1);
    const orbit = moonOrbit(time.getTime(), 24);
    expect(orbit).toHaveLength(25);
    // A sidereal month brings the Moon back to about the same place.
    expect(length(orbit[0].map((n, i) => n - orbit[24][i]))).toBeLessThan(40000);
  });
});

describe("Debris and inactive objects", () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "public/data/satellites.json"), "utf8"));
  const [a, b, c] = fixture.elements as OrbitalElements[];
  const satellites = prepareSatellites({
    fetchedAt: fixture.fetchedAt, source: "CelesTrak debris groups",
    elements: [{ ...a, NORAD_CAT_ID: 29001, OBJECT_NAME: "FENGYUN 1C DEB" }, { ...b, NORAD_CAT_ID: 29002, OBJECT_NAME: "SL-8 R/B" },
      { ...c, NORAD_CAT_ID: 29003, OBJECT_NAME: "COSMOS 2251" }],
    catalogue: { fetchedAt: fixture.fetchedAt, source: "CelesTrak debris groups", objects: {
      "29001": { objectType: "DEB", owner: "", launchDate: "", internationalId: "" },
      "29002": { objectType: "R/B", owner: "", launchDate: "", internationalId: "" },
      "29003": { objectType: "PAY", owner: "", launchDate: "", internationalId: "" },
    } },
  }).map((s) => ({ ...s, inactive: true }));

  it("get their own classes and descriptions", () => {
    expect(satellites.map(orbitClass)).toEqual(["debris", "rocket", "inactive"]);
    expect(satellites.map((s) => describeSatellite(s).label)).toEqual(["Space debris", "Rocket body", "Inactive satellite"]);
  });
});

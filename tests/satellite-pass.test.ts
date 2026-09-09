import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareSatellites, satellitePosition } from "../src/sky";
import { satellitePass, splitPass } from "../src/satellite-pass";
import { angularDistance } from "../src/projection";

const data = JSON.parse(
  readFileSync(
    new URL("../public/data/satellites.json", import.meta.url),
    "utf8",
  ),
);
const satellites = prepareSatellites(data);
const site = { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 };
const time = new Date(data.fetchedAt).getTime();
const visible = satellites.find((s) => {
  const p = satellitePosition(s, new Date(time), site);
  return Number(s.elements.MEAN_MOTION) > 10 && p && p.alt > 10;
})!;

describe("Full satellite pass", () => {
  it("reaches both geometric horizons and stops before the next orbit", () => {
    expect(visible).toBeTruthy();
    const pass = satellitePass(visible, time, site);
    expect(pass.rises && pass.sets).toBe(true);
    expect(pass.points[0].alt).toBe(0);
    expect(pass.points.at(-1)!.alt).toBe(0);
    expect(pass.points[0].time).toBeLessThan(time - 120000);
    expect(pass.points.at(-1)!.time).toBeGreaterThan(time);
    expect(
      satellitePosition(visible, new Date(pass.points[0].time - 1000), site)!
        .alt,
    ).toBeLessThan(0);
    expect(
      satellitePosition(
        visible,
        new Date(pass.points.at(-1)!.time + 1000),
        site,
      )!.alt,
    ).toBeLessThan(0);
    for (let i = 1; i < pass.points.length; i++) {
      const a = pass.points[i - 1],
        b = pass.points[i];
      expect(b.time).toBeGreaterThan(a.time);
      expect(b.alt).toBeGreaterThanOrEqual(0);
      expect(
        angularDistance(a.az / 15, a.alt, b.az / 15, b.alt),
      ).toBeLessThanOrEqual(1.501);
    }
  });
  it("reuses the pass while splitting solid and dashed paths exactly at the current satellite", () => {
    const pass = satellitePass(visible, time, site);
    expect(satellitePass(visible, time + 1000, site)).toBe(pass);
    const current = {
      time: time + 1000,
      ...satellitePosition(visible, new Date(time + 1000), site)!,
    };
    const paths = splitPass(pass, current);
    expect(paths.past.at(-1)).toBe(current);
    expect(paths.future[0]).toBe(current);
    expect(paths.past[0].alt).toBe(0);
    expect(paths.future.at(-1)!.alt).toBe(0);
  });
  it("does not invent a pass for an object below the horizon", () => {
    const below = satellites.find(
      (s) => satellitePosition(s, new Date(time), site)!.alt < -5,
    )!;
    expect(satellitePass(below, time, site).points).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  containsField,
  fieldRadius,
  paddedField,
  starPosition,
  mergeStars,
  deepFieldLimit,
} from "../src/star-catalogue";
import type { Star, View } from "../src/types";
import { nearbyStars } from "../src/sky";
const star = (overrides: Partial<Star> = {}): Star => ({
  id: "s1",
  hip: "1",
  name: "Test",
  named: false,
  ra: 0,
  dec: 0,
  mag: 6,
  dist: 10,
  spec: "",
  con: "",
  lum: null,
  ci: null,
  pmra: null,
  pmdec: null,
  x: 1,
  y: 0,
  z: 0,
  ...overrides,
});

describe("Deeper star catalogue geometry", () => {
  it("keeps duplicate matching specific to the base catalogue across changing fields", () => {
    const base = [star()], replacement = [star({ id: "different", hip: "2" })];
    const candidate = star({ id: "gaia123", source: "Gaia DR3" });
    expect(mergeStars(base, [candidate], null)).toEqual(base);
    expect(mergeStars(replacement, [candidate], candidate)).toEqual([...replacement, candidate]);
    expect(mergeStars(base, [candidate], candidate)).toEqual(base);
  });
  it("finds the same six neighbours as a full distance sort, including ties and unknown distances", () => {
    const selected = star({ x: 0, y: 0, z: 0 });
    const sample = Array.from({ length: 80 }, (_, i) => star({ id: `s${i + 2}`, x: (i * 17) % 13,
      y: 0, z: 0, dist: i % 11 === 0 ? null : i + 1 }));
    sample.push(selected);
    const expected = sample.filter(s => s.id !== selected.id && s.dist !== null)
      .map(s => ({ star: s, distance: Math.hypot(s.x, s.y, s.z) * 3.2615638 }))
      .sort((a, b) => a.distance - b.distance).slice(0, 6);
    expect(nearbyStars(selected, sample)).toEqual(expected);
    expect(nearbyStars(selected, [selected])).toEqual([]);
  });
  it("uses each catalogue reference epoch, including across RA zero and at the pole", () => {
    const s = star({ ra: 23.999, dec: 60, epoch: 2016, pmra: 1000 });
    expect(starPosition(s, 2016).ra).toBeCloseTo(s.ra, 8);
    const expected = (10 * 1000) / (3600000 * 15 * 0.5);
    expect(starPosition(s, 2026).ra - s.ra).toBeCloseTo(expected, 7);
    const pole = starPosition(
      star({ dec: 90, pmra: 10000, pmdec: 10000 }),
      2100,
    );
    expect(Number.isFinite(pole.ra) && Number.isFinite(pole.dec)).toBe(true);
    expect(pole.dec).toBeLessThan(90);
  });
  it("keeps requests across small pans, RA wrap and polar longitude changes", () => {
    const outer = { ra: 359.8, dec: 0, radius: 2, magnitude: 14 };
    expect(containsField(outer, { ...outer, ra: 0.2, radius: 1 })).toBe(true);
    expect(containsField(outer, { ...outer, ra: 3, radius: 1 })).toBe(false);
    expect(containsField(outer, { ...outer, radius: 1, magnitude: 14.1 })).toBe(
      false,
    );
    expect(
      containsField(
        { ...outer, dec: 89.9 },
        { ...outer, ra: 180, dec: 89.9, radius: 1 },
      ),
    ).toBe(true);
  });
  it("covers personal-view corners and bounds requests at every magnitude tier", () => {
    for (const magnitude of [8, 10, 10.1, 12, 12.1, 14])
      for (const mode of ["personal", "horizon"] as const) {
        const view: View = {
          mode,
          az: 180,
          alt: 45,
          fov: deepFieldLimit(magnitude),
        };
        const field = {
          ra: 359.99,
          dec: 45.03,
          radius: fieldRadius(view),
          magnitude,
        };
        const query = paddedField(field);
        expect(containsField(query, field)).toBe(true);
        expect(query.radius).toBeLessThanOrEqual(
          magnitude <= 10 ? 32 : magnitude <= 12 ? 16 : 8,
        );
      }
  });
  it("retains HYG identities, matches high-motion nearby stars at 2016, and pins selections once", () => {
    const nearby = star({ id: "near", hip: "", pmra: 1000 });
    const pos = starPosition(nearby, 2016);
    const base = [star(), nearby];
    const same = star({ id: "gaia123", hip: "1", source: "Gaia DR3" });
    const moving = star({
      id: "gaia456",
      hip: "",
      ...pos,
      source: "Gaia DR3",
      epoch: 2016,
    });
    const newStar = star({
      id: "gaia999",
      hip: "",
      ra: 6,
      mag: 13,
      source: "Gaia DR3",
    });
    const result = mergeStars(base, [same, moving, newStar], newStar);
    expect(result.map((s) => s.id)).toEqual(["s1", "near", "gaia999"]);
    expect(mergeStars(base, [], newStar).at(-1)?.id).toBe("gaia999");
  });
});

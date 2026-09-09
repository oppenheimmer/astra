import { describe, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { unpackOverview } from "../src/useGaiaOverview";

describe("Bundled Gaia whole-sky layer", () => {
  it("contains the complete extracted G9 sample with intact IDs, sky coverage and distance units", () => {
    const packed = JSON.parse(gunzipSync(readFileSync(new URL("../public/data/gaia-overview.json.gz", import.meta.url))).toString());
    const { stars, vectors } = unpackOverview(packed);
    expect(stars).toHaveLength(140763);
    expect(new Set(stars.map(s => s.id)).size).toBe(stars.length);
    expect(stars[0].mag).toBeGreaterThanOrEqual(7.5);
    expect(stars.at(-1)!.mag).toBe(9);
    expect(stars.some(s => s.dec > 89)).toBe(true);
    expect(stars.some(s => s.dec < -89)).toBe(true);
    for (const i of [0, 1000, 10000, stars.length - 1]) {
      const s = stars[i];
      expect(s.gaiaId).toBe(packed.rows[i][0]);
      expect(s.id).toBe(`gaia${s.gaiaId}`);
      expect(Math.hypot(...vectors.slice(i * 3, i * 3 + 3))).toBeCloseTo(1, 12);
      if (s.dist) expect(Math.hypot(s.x, s.y, s.z) * 3.2615638).toBeCloseTo(s.dist, 6);
    }
  });
  it("rejects invalid coordinates and numeric 64-bit IDs", () => {
    const data = { source: "Gaia DR3", epoch: 2016, magnitude: 9, count: 1,
      rows: [["1234567890123456789", "", 12, 45, 8, null, null, null]] };
    for (const [column, value] of [[0, 1234567890123456789], [2, 25], [3, 91], [4, NaN]]) {
      const invalid = structuredClone(data);
      invalid.rows[0][column as number] = value;
      expect(() => unpackOverview(invalid as Parameters<typeof unpackOverview>[0])).toThrow();
    }
  });
});

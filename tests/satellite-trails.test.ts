import { describe, expect, it } from "vitest";
import { packPasses, passContains, passSplit } from "../src/satellite-trails";

describe("Transferred satellite trail samples", () => {
  it("preserves horizon samples and millisecond times across empty and multiple passes", () => {
    const pass = { rises: true, sets: true, points: [
      { time: 1788800000000, az: 359.9, alt: 0 },
      { time: 1788800000100, az: 0.1, alt: 45.123456789 },
      { time: 1788800000200, az: 180.5, alt: 0 },
    ] };
    const packed = packPasses([pass, { ...pass, points: [] }, pass]);
    expect(packed.offsets).toEqual([0, 9, 9, 18]);
    for (const offset of [0, 9])
      pass.points.forEach((p, i) => expect(Array.from(packed.points.slice(offset + i * 3, offset + i * 3 + 3)))
        .toEqual([p.time, p.az, p.alt]));
    const points = packed.points.subarray(0, 9);
    expect(passContains(points, pass.points[0].time - 1)).toBe(false);
    expect(passContains(points, pass.points[2].time + 1)).toBe(false);
    expect(passContains(points, pass.points[0].time)).toBe(true);
    expect(passContains(points, pass.points[2].time)).toBe(true);
    expect(passContains(new Float64Array(), pass.points[0].time)).toBe(false);
    expect(passSplit(points, pass.points[0].time)).toBe(0);
    expect(passSplit(points, pass.points[1].time - 1)).toBe(3);
    expect(passSplit(points, pass.points[1].time)).toBe(3);
    expect(passSplit(points, pass.points[1].time + 1)).toBe(6);
    expect(passSplit(points, pass.points[2].time + 1)).toBe(9);
  });
});

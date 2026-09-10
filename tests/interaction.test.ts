import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  anchorDirection,
  angularDistance,
  angularLimb,
  personalView,
  project,
  unproject,
  zoomAt,
} from "../src/projection";
import { prepareSatellites, solarOrbits, solarPositions } from "../src/sky";
import { describeSatellite } from "../src/satellite-info";
import type { View } from "../src/types";

describe("Personal horizon-to-zenith view", () => {
  const view: View = { mode: "personal", az: 350, alt: 45, fov: 90 };
  it("maps heading ±45° into a curved wedge whose sides meet at the zenith", () => {
    for (const aspect of [1.14, 2]) {
      for (const offset of [-45, -20, 0, 20, 45])
        for (const alt of [0, 20, 45, 75, 89.9]) {
          const az = (view.az + offset + 360) % 360;
          const pixel = project(az, alt, view, 400, 350, 200, aspect)!;
          expect(pixel.inside).toBe(true);
          const actual = unproject(
            pixel.x,
            pixel.y,
            view,
            400,
            350,
            200,
            false,
            aspect,
          )!;
          expect(actual.alt).toBeCloseTo(alt, 6);
          expect(actual.az).toBeCloseTo(az, 6);
        }
      expect(
        unproject(400 + 199 * aspect, 151, view, 400, 350, 200, false, aspect),
      ).toBeNull();
      expect(project(170, 45, view, 400, 350, 200, aspect)?.inside).toBe(false);
      const left = project(305, 0, view, 400, 350, 200, aspect)!;
      expect(left.y).toBeLessThan(
        project(350, 0, view, 400, 350, 200, aspect)!.y,
      );
      for (const az of [0, 90, 180, 270]) {
        const top = project(az, 90, view, 400, 350, 200, aspect)!;
        expect(top.x).toBeCloseTo(400, 6);
        expect(top.y).toBeCloseTo(150, 6);
      }
    }
  });
  it("preserves a sky anchor through repeated upright zoom cycles", () => {
    for (const aspect of [1.14, 2]) {
      let next = view;
      const anchor = { az: 357, alt: 70 };
      const { x, y } = project(
        anchor.az,
        anchor.alt,
        view,
        400,
        350,
        200,
        aspect,
      )!;
      for (let i = 0; i < 20; i++) {
        next = zoomAt(next, i % 2 ? 90 : 2, x, y, 400, 350, 200, aspect);
        const pixel = project(
          anchor.az,
          anchor.alt,
          next,
          400,
          350,
          200,
          aspect,
        )!;
        expect(next.mode).toBe("personal");
        expect(next.roll).toBe(0);
        expect(pixel.x).toBeCloseTo(x, 5);
        expect(pixel.y).toBeCloseTo(y, 5);
      }
    }
  });
  it("turns through north, stays upright and restores the full sector", () => {
    const moved = anchorDirection(
      view,
      { az: 350, alt: 45 },
      300,
      350,
      400,
      350,
      200,
      1.14,
    );
    expect(moved.az).toBeGreaterThan(0);
    expect(moved.az).toBeLessThan(30);
    expect(moved.alt).toBe(45);
    expect(moved.roll).toBe(0);
    const zoomed = personalView({ ...moved, alt: 80 }, 10);
    expect(personalView(zoomed, 150)).toEqual({ ...moved, fov: 90 });
  });
  it("keeps solar and lunar limbs circular at every elevation and screen aspect", () => {
    for (const aspect of [1.14, 2])
      for (const alt of [0, 45, 75, 89.9]) {
        const points = angularLimb(355, alt, 0.5).map((h) =>
          project(h.az, h.alt, view, 400, 350, 200, aspect)!,
        );
        const [a, b, c] = [points[0], points[32], points[64]];
        const d =
          2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
        const n = (p: { x: number; y: number }) => p.x * p.x + p.y * p.y;
        const x =
          (n(a) * (b.y - c.y) + n(b) * (c.y - a.y) + n(c) * (a.y - b.y)) / d;
        const y =
          (n(a) * (c.x - b.x) + n(b) * (a.x - c.x) + n(c) * (b.x - a.x)) / d;
        const radii = points.map((p) => Math.hypot(p.x - x, p.y - y));
        expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.000001);
      }
  });
});

describe("Apparent solar and lunar disks", () => {
  it("keeps every limb point at the true angular radius, including near the zenith", () => {
    for (const [az, alt] of [
      [359.9, 45],
      [25, 89.9],
      [180, 0],
    ])
      for (const point of angularLimb(az, alt, 0.5))
        expect(
          angularDistance(az / 15, alt, point.az / 15, point.alt),
        ).toBeCloseTo(0.25, 6);
  });
  it("scales a half-degree disk with angular field instead of a fixed symbol radius", () => {
    const limb = angularLimb(180, 45, 0.5);
    const width = (fov: number) => {
      const pixels = limb.map((h) =>
        project(
          h.az,
          h.alt,
          { mode: "horizon", az: 180, alt: 45, fov },
          400,
          350,
          300,
        )!,
      );
      return (
        Math.max(...pixels.map((p) => p.x)) -
        Math.min(...pixels.map((p) => p.x))
      );
    };
    expect(width(1)).toBeCloseTo(300, 1);
    expect(width(10) / width(1)).toBeCloseTo(0.1, 3);
  });
});

describe("Pointer-centred spherical zoom", () => {
  it("keeps the anchor at the same pixel, including azimuth wrap and the zenith", () => {
    const views: View[] = [
      { mode: "horizon", az: 359, alt: 42, fov: 110 },
      { mode: "horizon", az: 0, alt: 89.99, fov: 110 },
      { mode: "horizon", az: 200, alt: -28, fov: 10, roll: 75 },
      { mode: "horizon", az: 275, alt: 70, fov: 0.5, roll: -35 },
      { mode: "allsky", az: 50, alt: 40, fov: 180 },
    ];
    for (const view of views)
      for (const [dx, dy] of [
        [0, 0],
        [0.7, 0.1],
        [-0.2, 0.8],
        [-0.6, -0.5],
        [0, -0.99],
      ]) {
        const x = 400 + dx * 300,
          y = 400 + dy * 300;
        const anchor = unproject(x, y, view, 400, 400, 300)!;
        for (const factor of [0.4, 1.6]) {
          const next = zoomAt(
            view,
            (view.mode === "allsky" ? 150 : view.fov) * factor,
            x,
            y,
            400,
            400,
            300,
          );
          const actual = project(anchor.az, anchor.alt, next, 400, 400, 300)!;
          expect(actual.x).toBeCloseTo(x, 4);
          expect(actual.y).toBeCloseTo(y, 4);
        }
      }
  });
  it("does not drift through repeated in/out cycles at an off-centre point", () => {
    let view: View = { mode: "horizon", az: 358, alt: 85, fov: 70 };
    const anchor = unproject(620, 300, view, 400, 400, 300)!;
    for (let i = 0; i < 40; i++)
      view = zoomAt(view, i % 2 ? 70 : 7, 620, 300, 400, 400, 300);
    const point = project(anchor.az, anchor.alt, view, 400, 400, 300)!;
    expect(point.x).toBeCloseTo(620, 4);
    expect(point.y).toBeCloseTo(300, 4);
  });
  it("supports a moving pinch midpoint or pan without losing the chosen direction", () => {
    const view: View = { mode: "horizon", az: 20, alt: 88, fov: 80, roll: 35 };
    const anchor = unproject(450, 390, view, 400, 400, 300)!;
    const moved = anchorDirection(
      { ...view, fov: 45 },
      anchor,
      520,
      470,
      400,
      400,
      300,
    );
    const point = project(anchor.az, anchor.alt, moved, 400, 400, 300)!;
    expect(point.x).toBeCloseTo(520, 5);
    expect(point.y).toBeCloseTo(470, 5);
    expect(zoomAt(view, 20, 800, 800, 400, 400, 300)).toBe(view);
  });
});

describe("Solar distances and satellite identification", () => {
  it("uses orbital coordinates in AU with a compact inner system and widely separated outer planets", () => {
    const positions = solarPositions(new Date("2026-09-05T22:00:00Z"));
    const earth = positions.find((p) => p.name === "Earth")!;
    expect(
      positions.find((p) => p.name === "Neptune")!.distance / earth.distance,
    ).toBeGreaterThan(28);
    expect(
      positions.find((p) => p.name === "Jupiter")!.distance / earth.distance,
    ).toBeGreaterThan(4.5);
    const earthOrbit = solarOrbits(2026).find((o) => o.name === "Earth")!;
    const radii = earthOrbit.points.map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...radii)).toBeGreaterThan(0.97);
    expect(Math.max(...radii)).toBeLessThan(1.03);
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(0.02);
  });
  it("distinguishes mission roles and rocket bodies by catalogue identity, not OMM classification code", () => {
    const load = (file: string) =>
      JSON.parse(
        readFileSync(
          new URL("../public/data/" + file, import.meta.url),
          "utf8",
        ),
      );
    const catalogue = load("satellite-catalogue.json");
    const satellites = prepareSatellites({
      ...load("satellites.json"),
      catalogue,
    });
    expect(
      describeSatellite(satellites.find((s) => s.id === "sat25544")!).label,
    ).toBe("Space station");
    expect(
      describeSatellite(satellites.find((s) => s.id === "sat20580")!).label,
    ).toBe("Space telescope");
    expect(
      describeSatellite(satellites.find((s) => s.id === "sat61047")!).label,
    ).toBe("Communications satellite");
    expect(
      describeSatellite(satellites.find((s) => s.id === "sat733")!).label,
    ).toBe("Rocket body");
    const unknown = {
      ...satellites[0],
      id: "sat999999",
      name: "UNKNOWN",
      metadata: undefined,
      elements: { ...satellites[0].elements, NORAD_CAT_ID: 999999, CLASSIFICATION_TYPE: "U" },
    };
    expect(describeSatellite(unknown).label).toBe("Type not catalogued");
    expect(
      describeSatellite({
        ...unknown,
        metadata: {
          objectType: "DEB",
          owner: "",
          launchDate: "",
          internationalId: "",
        },
      }).label,
    ).toBe("Space debris");
    expect(satellites.every((s) => s.metadata?.objectType)).toBe(true);
  });
});

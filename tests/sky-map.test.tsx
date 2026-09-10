// @vitest-environment jsdom
import { useState, type PointerEvent } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjector, project, unproject } from "../src/projection";
import { hitSkyObject, type PlottedObject } from "../src/sky-map-hit-testing";
import { drawSkyObjects } from "../src/sky-map-layers";
import { useSkyMapPointer } from "../src/useSkyMapPointer";
import { skyPalette } from "../src/theme";
import type { Sky, SkyObject, Telescope, TerrainProfile, View } from "../src/types";

const object: SkyObject = {
  id: "star", name: "Star", kind: "star", ra: 0, dec: 0,
  az: 180, alt: 45, mag: 2, distance: 1, unit: "ly", subtitle: "Star",
};
const initialView: View = { mode: "horizon", az: 180, alt: 45, fov: 90 };
const sky: Sky = {
  objects: [object], byId: new Map([[object.id, object]]), lines: [], count: 1,
  sunAltitude: -20, time: new Date("2026-09-10T00:00:00Z"),
  site: { name: "Site", lat: 45, lon: 0, elevation: 0 },
};
const telescope: Telescope = {
  connected: false, ra: 0, dec: 0, targetRa: 0, targetDec: 0, targetId: null,
  moving: false, tracking: false, shape: "circle", width: 1, height: 1,
};
const point = (o = object, x = 400, y = 350, r = 2): PlottedObject => ({ o, x, y, r });
const inside = (x: number, y: number) => Math.hypot(x - 400, y - 350) <= 300;

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Sky map hit testing", () => {
  it("ignores objects outside the viewport", () => {
    expect(hitSkyObject([point(object, 20, 20)], { x: 20, y: 20 }, 24, inside)).toBeNull();
  });

  it("measures nearest symbol edges and preserves the larger touch tolerance", () => {
    const small = point(object, 400, 350, 2);
    const large = point({ ...object, id: "planet", kind: "planet" }, 410, 350, 12);
    expect(hitSkyObject([small, large], { x: 425, y: 350 }, 16, inside)).toBe(large);
    expect(hitSkyObject([small], { x: 423, y: 350 }, 16, inside)).toBeNull();
    expect(hitSkyObject([small], { x: 423, y: 350 }, 24, inside)).toBe(small);
  });

  it("uses the filled disk above stars in CSS pixels without enlarging empty corners", () => {
    const star = point();
    const disk = { ...point({ ...object, id: "Moon" }), disk: {} as Path2D, r: 100 };
    const calls: string[] = [];
    const context = {
      save: () => calls.push("save"), resetTransform: () => calls.push("reset"),
      restore: () => calls.push("restore"),
      isPointInPath: vi.fn(() => true),
    } as unknown as CanvasRenderingContext2D;
    expect(hitSkyObject([star, disk], { x: 400, y: 350 }, 16, inside, context)).toBe(disk);
    expect(context.isPointInPath).toHaveBeenCalledWith(disk.disk, 400, 350);
    expect(calls).toEqual(["save", "reset", "restore"]);
    vi.mocked(context.isPointInPath).mockReturnValue(false);
    expect(hitSkyObject([disk], { x: 470, y: 350 }, 16, inside, context)).toBeNull();
  });
});

describe("Sky map object layer", () => {
  it("retains terrain-visible stars while filtering hidden planets, faint stars and disabled layers", () => {
    const visible = { ...object, alt: 5 };
    const hiddenPlanet = { ...visible, id: "planet", kind: "planet" as const };
    const faint = { ...visible, id: "faint", mag: 12 };
    const disabledSatellite = { ...object, id: "satellite", kind: "satellite" as const };
    const terrain: TerrainProfile = {
      lat: 45, lon: 0, heightAboveGround: 1.5, groundElevation: 0, step: 90,
      altitudes: [10, 10, 10, 10], rangeKm: 100, source: "Fixture", approximate: false,
    };
    const c = new Proxy({} as CanvasRenderingContext2D, {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    });
    const objects = [visible, hiddenPlanet, faint, disabledSatellite];
    const plotted = drawSkyObjects(c, {
      sky: { ...sky, objects }, view: initialView, starMagnitude: 10,
      layers: { star: true, planet: true, satellite: false, galaxy: true, grid: false, constellation: false },
    }, { getPoint: createProjector(initialView, 400, 350, 300), cx: 400, cy: 350, r: 300, aspect: 1 }, terrain, skyPalette.light);
    expect(plotted.map(p => p.o.id)).toEqual([visible.id]);
    expect(plotted[0].r).toBeGreaterThan(0);
    expect(plotted[0].x).toBeCloseTo(project(visible.az, visible.alt, initialView, 400, 350, 300)!.x);
  });
});

function pointer(x: number, y: number, id = 1, type = "mouse") {
  return { clientX: x + 10, clientY: y + 20, pointerId: id, pointerType: type } as PointerEvent;
}

function mountPointer({ aiming = false } = {}) {
  const host = document.createElement("div");
  const capture = vi.fn();
  host.setPointerCapture = capture;
  host.getBoundingClientRect = () => ({ left: 10, top: 20, width: 800, height: 700 }) as DOMRect;
  const hostRef = { current: host };
  const canvasRef = { current: null };
  const points = { current: [point()] };
  const select = vi.fn();
  const aim = vi.fn();
  const rendered = renderHook(({ currentSky }) => {
    const [view, setView] = useState(initialView);
    const handlers = useSkyMapPointer({
      sky: currentSky, view, setView, selected: null, starMagnitude: 10,
      terrain: null, telescope, aiming, select, aim,
    }, {
      size: { w: 800, h: 700 }, cx: 400, cy: 350, r: 300, aspect: 1,
      getPoint: createProjector(view, 400, 350, 300), inside,
    }, hostRef, canvasRef, points);
    return { view, handlers };
  }, { initialProps: { currentSky: sky } });
  return { ...rendered, host, select, aim, capture, points };
}

describe("Sky map pointer interactions", () => {
  it("selects the pressed identity after the sky refreshes during a click", () => {
    const f = mountPointer();
    act(() => f.result.current.handlers.pointerDown(pointer(400, 350)));
    const moved = { ...object, alt: 46 };
    f.points.current = [point(moved, 450)];
    f.rerender({ currentSky: { ...sky, objects: [moved], byId: new Map([[moved.id, moved]]) } });
    act(() => f.result.current.handlers.pointerUp(pointer(400, 350)));
    expect(f.select).toHaveBeenCalledWith(moved);
    expect(f.capture).toHaveBeenCalledWith(1);
  });

  it("pans around the pressed sky direction and suppresses click selection after dragging", () => {
    const f = mountPointer();
    const anchor = unproject(420, 350, initialView, 400, 350, 300)!;
    act(() => f.result.current.handlers.pointerDown(pointer(420, 350)));
    act(() => f.result.current.handlers.pointerMove(pointer(470, 390)));
    const projected = project(anchor.az, anchor.alt, f.result.current.view, 400, 350, 300)!;
    expect(projected.x).toBeCloseTo(470, 5);
    expect(projected.y).toBeCloseTo(390, 5);
    expect(f.result.current.handlers.isDragging).toBe(true);
    act(() => f.result.current.handlers.pointerUp(pointer(470, 390)));
    expect(f.select).not.toHaveBeenCalled();
    expect(f.result.current.handlers.isDragging).toBe(false);
  });

  it("accumulates wheel events from the latest queued view and cleans up its listener", () => {
    const f = mountPointer();
    const wheel = () => new WheelEvent("wheel", { clientX: 410, clientY: 370, deltaY: -100, cancelable: true });
    const first = wheel();
    act(() => { f.host.dispatchEvent(first); f.host.dispatchEvent(wheel()); });
    expect(first.defaultPrevented).toBe(true);
    expect(f.result.current.view.fov).toBeCloseTo(90 * Math.exp(-0.3));
    f.unmount();
    const afterUnmount = wheel();
    f.host.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
  });

  it("moves the pinch midpoint while zooming without selecting an object", () => {
    const f = mountPointer();
    const anchor = unproject(400, 350, initialView, 400, 350, 300)!;
    act(() => {
      f.result.current.handlers.pointerDown(pointer(350, 350, 1, "touch"));
      f.result.current.handlers.pointerDown(pointer(450, 350, 2, "touch"));
    });
    act(() => f.result.current.handlers.pointerMove(pointer(550, 350, 2, "touch")));
    expect(f.result.current.view.fov).toBeCloseTo(45);
    const projected = project(anchor.az, anchor.alt, f.result.current.view, 400, 350, 300)!;
    expect(projected.x).toBeCloseTo(450, 5);
    act(() => f.result.current.handlers.pointerUp(pointer(550, 350, 2, "touch")));
    expect(f.select).not.toHaveBeenCalled();
  });

  it("cancels a gesture without leaving a pending selection and clears hover on view changes", () => {
    const f = mountPointer();
    act(() => f.result.current.handlers.pointerMove(pointer(400, 350)));
    expect(f.result.current.handlers.hover?.object).toBe(object);
    act(() => {
      f.result.current.handlers.pointerDown(pointer(400, 350));
      f.result.current.handlers.pointerCancel();
      f.result.current.handlers.pointerUp(pointer(400, 350));
    });
    expect(f.select).not.toHaveBeenCalled();
    expect(f.result.current.handlers.hover).toBeNull();
    act(() => f.result.current.handlers.pointerMove(pointer(400, 350)));
    act(() => f.host.dispatchEvent(new WheelEvent("wheel", { clientX: 410, clientY: 370, deltaY: -100 })));
    expect(f.result.current.handlers.hover).toBeNull();
  });

  it("aims at the released sky direction when aiming is enabled", () => {
    const f = mountPointer({ aiming: true });
    act(() => f.result.current.handlers.pointerDown(pointer(400, 350)));
    act(() => f.result.current.handlers.pointerUp(pointer(430, 380)));
    const expected = unproject(430, 380, initialView, 400, 350, 300)!;
    expect(f.aim).toHaveBeenCalledWith(expected.az, expected.alt);
    expect(f.select).not.toHaveBeenCalled();
  });
});

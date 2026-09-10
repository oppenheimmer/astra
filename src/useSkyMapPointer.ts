import { useEffect, useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from "react";
import { anchorDirection, clamp, unproject, wrap, zoomAt, type createProjector } from "./projection";
import { equatorialToHorizontal } from "./sky";
import { hitSkyObject, type PlottedObject } from "./sky-map-hit-testing";
import type { Sky, SkyObject, Telescope, TerrainProfile, View } from "./types";

interface PointerOptions {
  sky: Sky;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  selected: SkyObject | null;
  starMagnitude: number;
  terrain: TerrainProfile | null;
  telescope: Telescope;
  aiming: boolean;
  aim: (az: number, alt: number) => void;
  select: (object: SkyObject) => void;
}
interface PointerGeometry {
  size: { w: number; h: number };
  cx: number;
  cy: number;
  r: number;
  aspect: number;
  getPoint: ReturnType<typeof createProjector>;
  inside: (x: number, y: number) => boolean;
}

/** Own pointer capture, hover, panning and zooming independently of drawing. */
export function useSkyMapPointer(
  p: PointerOptions,
  geometry: PointerGeometry,
  host: RefObject<HTMLDivElement | null>,
  canvas: RefObject<HTMLCanvasElement | null>,
  points: RefObject<PlottedObject[]>,
) {
  const { size, cx, cy, r, aspect, getPoint, inside } = geometry;
  const [isDragging, setDragging] = useState(false);
  const [hover, setHover] = useState<{ object: SkyObject; x: number; y: number } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    az: number;
    alt: number;
    moved: boolean;
    id: number;
    objectId?: string;
    field: boolean;
    view: View;
  } | null>(null);
  const pinch = useRef(new Map<number, { x: number; y: number }>());
  useEffect(() => setHover(null), [p.view, p.selected?.id, p.starMagnitude, p.terrain]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta =
        e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1);
      const rect = node.getBoundingClientRect();
      // Trackpad events can arrive before React commits the preceding event.
      // Apply each delta to the latest queued camera, never a render's old view.
      p.setView((view) =>
        zoomAt(
          view,
          (view.mode === "allsky" ? 150 : view.fov) * Math.exp(delta * 0.0015),
          e.clientX - rect.left,
          e.clientY - rect.top,
          cx,
          cy,
          r,
          aspect,
        ),
      );
      setHover(null);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [p.setView, size, cx, cy, r, aspect]);
  const position = (e: PointerEvent) => {
    const b = host.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const hitObject = (pos: { x: number; y: number }, tolerance: number) => {
    return hitSkyObject(points.current, pos, tolerance, inside, canvas.current?.getContext("2d"));
  };
  const pointerDown = (e: PointerEvent) => {
    const pos = position(e);
    if (!inside(pos.x, pos.y)) return;
    pinch.current.set(e.pointerId, pos);
    host.current?.setPointerCapture(e.pointerId);
    const h = p.telescope.connected
      ? equatorialToHorizontal(
          p.telescope.ra,
          p.telescope.dec,
          p.sky.time,
          p.sky.site,
        )
      : null;
    const field = h ? getPoint(h.az, h.alt) : null;
    drag.current = {
      ...pos,
      az: p.view.az,
      alt: p.view.alt,
      moved: false,
      id: e.pointerId,
      objectId: hitObject(pos, e.pointerType === "touch" ? 24 : 16)?.o.id,
      view: p.view,
      field:
        !!field?.inside && Math.hypot(pos.x - field.x, pos.y - field.y) < 26,
    };
    setHover(null);
    setDragging(false);
  };
  const pointerMove = (e: PointerEvent) => {
    const pos = position(e);
    if (pinch.current.size === 2 && pinch.current.has(e.pointerId)) {
      const old = [...pinch.current.values()],
        before = Math.hypot(old[0].x - old[1].x, old[0].y - old[1].y);
      pinch.current.set(e.pointerId, pos);
      const after = [...pinch.current.values()],
        distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      if (before && distance) {
        const oldX = (old[0].x + old[1].x) / 2,
          oldY = (old[0].y + old[1].y) / 2;
        const newX = (after[0].x + after[1].x) / 2,
          newY = (after[0].y + after[1].y) / 2;
        p.setView((view) => {
          const anchor = unproject(oldX, oldY, view, cx, cy, r, false, aspect);
          const zoomed = zoomAt(
            view,
            ((view.mode === "allsky" ? 150 : view.fov) * before) / distance,
            oldX, oldY, cx, cy, r, aspect,
          );
          return anchor
            ? anchorDirection(zoomed, anchor, newX, newY, cx, cy, r, aspect)
            : zoomed;
        });
      }
      if (drag.current) drag.current.moved = true;
      setDragging(true);
      return;
    }
    if (drag.current) {
      const d = drag.current,
        dx = pos.x - d.x,
        dy = pos.y - d.y;
      if (Math.hypot(dx, dy) > 4 && !d.moved) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved && !p.aiming && !d.field) {
        const anchor = unproject(d.x, d.y, d.view, cx, cy, r, false, aspect);
        p.setView(
          anchor
            ? anchorDirection(d.view, anchor, pos.x, pos.y, cx, cy, r, aspect)
            : {
                ...p.view,
                mode: "horizon",
                az: wrap(d.az - (dx * p.view.fov) / (2 * r)),
                alt: clamp(d.alt + (dy * p.view.fov) / (2 * r), -30, 89),
              },
        );
        setHover(null);
      }
      return;
    }
    const nearest = hitObject(pos, e.pointerType === "touch" ? 24 : 16);
    setHover(nearest ? { object: nearest.o, x: pos.x, y: pos.y } : null);
  };
  const pointerUp = (e: PointerEvent) => {
    const pos = position(e),
      d = drag.current;
    pinch.current.delete(e.pointerId);
    setDragging(false);
    if (!d) return;
    if (p.aiming || (d.field && d.moved)) {
      const h = unproject(pos.x, pos.y, p.view, cx, cy, r, false, aspect);
      if (h) p.aim(h.az, h.alt);
    } else if (!d.moved) {
      const object =
        (d.objectId ? p.sky.byId.get(d.objectId) : null) ??
        hitObject(pos, e.pointerType === "touch" ? 24 : 16)?.o;
      if (object) p.select(object);
    }
    drag.current = null;
  };
  const pointerCancel = () => {
    drag.current = null;
    pinch.current.clear();
    setDragging(false);
  };
  const pointerLeave = () => setHover(null);
  return { hover, isDragging, drag, pointerDown, pointerMove, pointerUp, pointerCancel, pointerLeave };
}

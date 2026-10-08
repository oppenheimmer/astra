import { useEffect, useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from "react";
import { dragCamera, zoomCamera, type GlobeCamera } from "./globe";
import type { SkyObject } from "./types";

/** A deep-space craft as drawn: hover shows it, but it is not a selectable sky object. */
export interface CraftHit {
  name: string;
  region: string;
  /** Kilometres from Earth's centre. */
  distance: number;
  x: number;
  y: number;
}
/** Where each satellite was last drawn, in CSS pixels; NaN when it was not drawn. */
export interface GlobeHits {
  objects: SkyObject[];
  xs: Float32Array;
  ys: Float32Array;
  craft?: CraftHit[];
}
/** The nearest drawn deep-space craft within `tolerance` pixels. */
export function hitCraft(hits: GlobeHits | null, x: number, y: number, tolerance: number) {
  let best: CraftHit | null = null,
    distance = tolerance;
  for (const craft of hits?.craft ?? []) {
    const d = Math.hypot(craft.x - x, craft.y - y);
    if (d < distance) {
      distance = d;
      best = craft;
    }
  }
  return best;
}
/** The nearest drawn satellite within `tolerance` pixels. */
export function hitGlobe(hits: GlobeHits | null, x: number, y: number, tolerance: number) {
  if (!hits) return null;
  let best = -1,
    distance = tolerance * tolerance;
  for (let i = 0; i < hits.objects.length; i++) {
    const dx = hits.xs[i] - x,
      dy = hits.ys[i] - y,
      d = dx * dx + dy * dy;
    // NaN never compares below the threshold, so undrawn satellites drop out here.
    if (d < distance) {
      distance = d;
      best = i;
    }
  }
  return best < 0 ? null : hits.objects[best];
}

interface Options {
  setCamera: Dispatch<SetStateAction<GlobeCamera>>;
  camera: GlobeCamera;
  /** Pixels per Earth radius in the current frame. */
  radius: number;
  height: number;
  select: (object: SkyObject) => void;
  /** Called for a click or tap on empty space, when that has a meaning. */
  clear?: () => void;
}

/** Turn the globe by dragging, zoom with the wheel or a pinch, and pick satellites by click or tap. */
export function useGlobePointer(
  p: Options,
  host: RefObject<HTMLDivElement | null>,
  hits: RefObject<GlobeHits | null>,
) {
  const [hover, setHover] = useState<{ object?: SkyObject; craft?: CraftHit; x: number; y: number } | null>(null);
  const [isDragging, setDragging] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    camera: GlobeCamera;
    radius: number;
    moved: boolean;
    objectId?: string;
  } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  useEffect(() => setHover(null), [p.camera]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? p.height : 1);
      // Apply each delta to the latest queued camera, never a render's old one.
      p.setCamera((camera) => zoomCamera(camera, Math.exp(-delta * 0.0015)));
      setHover(null);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [p.setCamera, p.height]);
  const position = (e: PointerEvent) => {
    const b = host.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const tolerance = (e: PointerEvent) => (e.pointerType === "touch" ? 24 : 12);
  /** Restart the drag from where the remaining finger is, so lifting one of two does not jump. */
  const anchor = (pos: { x: number; y: number }, moved: boolean) => {
    drag.current = { ...pos, camera: p.camera, radius: p.radius, moved };
  };
  const pointerDown = (e: PointerEvent) => {
    const pos = position(e);
    pointers.current.set(e.pointerId, pos);
    host.current?.setPointerCapture?.(e.pointerId);
    if (pointers.current.size > 1) {
      // A second finger turns the gesture into a pinch; it is never a tap.
      if (drag.current) drag.current.moved = true;
      return;
    }
    anchor(pos, false);
    drag.current!.objectId = hitGlobe(hits.current, pos.x, pos.y, tolerance(e))?.id;
    setHover(null);
    setDragging(false);
  };
  const pointerMove = (e: PointerEvent) => {
    const pos = position(e);
    if (pointers.current.size === 2 && pointers.current.has(e.pointerId)) {
      const [a, b] = [...pointers.current.values()];
      const before = Math.hypot(a.x - b.x, a.y - b.y);
      pointers.current.set(e.pointerId, pos);
      const [c, d] = [...pointers.current.values()];
      const after = Math.hypot(c.x - d.x, c.y - d.y);
      if (before && after) p.setCamera((camera) => zoomCamera(camera, after / before));
      setDragging(true);
      return;
    }
    const d = drag.current;
    if (d && pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, pos);
      const dx = pos.x - d.x,
        dy = pos.y - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 4) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved) p.setCamera(dragCamera(d.camera, dx, dy, d.radius));
      return;
    }
    const nearest = hitGlobe(hits.current, pos.x, pos.y, tolerance(e));
    const craft = nearest ? null : hitCraft(hits.current, pos.x, pos.y, tolerance(e));
    setHover(nearest ? { object: nearest, ...pos } : craft ? { craft, ...pos } : null);
  };
  const pointerUp = (e: PointerEvent) => {
    const pos = position(e),
      d = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1) {
      anchor([...pointers.current.values()][0], true);
      return;
    }
    setDragging(false);
    drag.current = null;
    if (!d || d.moved) return;
    const object =
      hits.current?.objects.find((o) => o.id === d.objectId) ??
      hitGlobe(hits.current, pos.x, pos.y, tolerance(e));
    if (object) p.select(object);
    else p.clear?.();
  };
  const pointerCancel = () => {
    drag.current = null;
    pointers.current.clear();
    setDragging(false);
  };
  const pointerLeave = () => setHover(null);
  return { hover, isDragging, drag, pointerDown, pointerMove, pointerUp, pointerCancel, pointerLeave };
}

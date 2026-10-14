import { useRef } from "react";

/** Detected from pointer releases rather than `dblclick`, which touch browsers do not send reliably. */
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_DISTANCE = 24;

/** Recognise a second click or tap on the same object in quick succession. */
export function useDoubleTap() {
  const last = useRef<{ id: string; time: number; x: number; y: number } | null>(null);
  /** Record a tap on an object; true when it completes a pair, so a third tap starts a new one. */
  const tap = (id: string, pos: { x: number; y: number }) => {
    const now = performance.now(),
      previous = last.current;
    const repeated =
      !!previous &&
      previous.id === id &&
      now - previous.time < DOUBLE_TAP_MS &&
      Math.hypot(pos.x - previous.x, pos.y - previous.y) < DOUBLE_TAP_DISTANCE;
    last.current = repeated ? null : { id, time: now, ...pos };
    return repeated;
  };
  const reset = () => {
    last.current = null;
  };
  return { tap, reset };
}

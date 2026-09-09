import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { describeSatellite } from "./satellite-info";
import type { Satellite, Site, SkyObject } from "./types";

type Request = { time: number; site: Site; siteKey: string };
type Frame = { time: number; siteKey: string; values: Float64Array; catalogue: Satellite[] };
const EMPTY: SkyObject[] = [];

/** Exact SGP4 positions run off the UI thread. Every plotted object shares the returned time. */
export function useSatelliteSky(satellites: Satellite[], time: number, site: Site) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [failed, setFailed] = useState(false);
  const send = useRef<((request: Request) => void) | null>(null);
  const latest = useRef<Request>({ time, site, siteKey: "" });
  const siteKey = `${site.lat},${site.lon},${site.elevation}`;
  latest.current = { time, site, siteKey };
  useEffect(() => {
    if (!satellites.length) return;
    if (typeof Worker === "undefined") { setFailed(true); return; }
    let worker: Worker;
    try { worker = new Worker(new URL("./satellite-worker.ts", import.meta.url), { type: "module" }); }
    catch { setFailed(true); return; }
    let busy = false, pending: Request | null = null;
    setFailed(false);
    const dispatch = (request: Request) => {
      if (busy) { pending = request; return; }
      busy = true;
      worker.postMessage(request);
    };
    worker.onmessage = (event: MessageEvent<Omit<Frame, "catalogue">>) => {
      busy = false;
      if (event.data.values.length !== satellites.length * 8) { setFailed(true); worker.terminate(); send.current = null; return; }
      startTransition(() => setFrame({ ...event.data, catalogue: satellites }));
      if (pending) { const request = pending; pending = null; dispatch(request); }
    };
    worker.onerror = () => { setFailed(true); worker.terminate(); send.current = null; };
    worker.postMessage({ type: "catalogue", elements: satellites.map(s => s.elements) });
    send.current = dispatch;
    dispatch(latest.current);
    return () => { send.current = null; worker.terminate(); };
  }, [satellites]);
  useEffect(() => { send.current?.({ time, site, siteKey }); }, [time, site, siteKey]);
  const current = frame?.catalogue === satellites && frame.siteKey === siteKey ? frame : null;
  const objects = useMemo(() => {
    if (!current) return EMPTY;
    const result: SkyObject[] = [], v = current.values;
    for (let i = 0; i < satellites.length; i++) {
      const offset = i * 8;
      if (!Number.isFinite(v[offset])) continue;
      const s = satellites[i];
      result.push({ id: s.id, name: s.name, kind: "satellite", satellite: s,
        subtitle: describeSatellite(s).label + " · NORAD " + s.elements.NORAD_CAT_ID, mag: 3, unit: "km",
        az: v[offset], alt: v[offset + 1], ra: v[offset + 2], dec: v[offset + 3],
        range: v[offset + 4], distance: v[offset + 4], velocity: v[offset + 5],
        sunlit: !!v[offset + 6], stale: !!v[offset + 7],
      });
    }
    return result;
  }, [current, satellites]);
  return { objects, time: failed ? time : current?.time ?? time, failed };
}

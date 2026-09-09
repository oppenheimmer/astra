import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { satellitePass } from "./satellite-pass";
import { packPasses, passContains, type PackedPasses } from "./satellite-trails";
import type { Satellite, Sky } from "./types";

type Cached = { satellite: Satellite; site: string; time: number; pass: Float64Array };
const siteKey = (sky: Sky) => `${sky.site.lat},${sky.site.lon},${sky.site.elevation}`;
const matches = (entry: Cached | undefined, satellite: Satellite, site: string, time: number) =>
  entry?.satellite === satellite && entry.site === site &&
  (entry.time === time || passContains(entry.pass, time));

/** Pass searches run independently of map drawing and the live-position worker. */
export function useSatelliteTrails(sky: Sky, enabled: boolean) {
  const cache = useRef(new Map<string, Cached>());
  const latest = useRef({ sky, enabled });
  latest.current = { sky, enabled };
  const send = useRef<(() => void) | null>(null);
  const [revision, refresh] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let worker: Worker;
    try { worker = new Worker(new URL("./satellite-trail-worker.ts", import.meta.url), { type: "module" }); }
    catch { setFailed(true); return; }
    setFailed(false);
    let busy = false;
    let job: { satellites: Satellite[]; site: string; time: number };
    const dispatch = () => {
      if (busy || !latest.current.enabled) return;
      const current = latest.current.sky, site = siteKey(current), time = current.time.getTime();
      const satellites = current.objects.flatMap(o =>
        o.satellite && o.alt >= 0 && !matches(cache.current.get(o.id), o.satellite, site, time)
          ? [o.satellite] : []);
      if (!satellites.length) return;
      job = { satellites, site, time };
      busy = true;
      worker.postMessage({ time, site: current.site,
        satellites: satellites.map(({ id, name, epoch, elements }) => ({ id, name, epoch, elements })) });
    };
    worker.onmessage = (event: MessageEvent<PackedPasses>) => {
      busy = false;
      const current = latest.current.sky, site = siteKey(current), time = current.time.getTime();
      let changed = false;
      // Discard superseded times, sites and orbital elements. Never draw an old pass after a jump.
      if (site === job.site) job.satellites.forEach((satellite, i) => {
        const pass = event.data.points.subarray(event.data.offsets[i], event.data.offsets[i + 1]);
        if (current.byId.get(satellite.id)?.satellite !== satellite ||
          (job.time !== time && !passContains(pass, time))) return;
        // Own each retained segment so a single long-lived pass cannot retain a whole batch.
        cache.current.set(satellite.id, { satellite, site, time: job.time, pass: pass.slice() });
        changed = true;
      });
      while (cache.current.size > 2048) cache.current.delete(cache.current.keys().next().value!);
      if (changed) startTransition(() => refresh(n => n + 1));
      // While busy, time requests are coalesced into the latest state, never queued individually.
      dispatch();
    };
    worker.onerror = () => { setFailed(true); worker.terminate(); send.current = null; };
    send.current = dispatch;
    dispatch();
    return () => { send.current = null; worker.terminate(); };
  }, [enabled]);
  useEffect(() => { send.current?.(); }, [sky, enabled]);
  return useMemo(() => {
    const passes = new Map<string, Float64Array>();
    if (!enabled) return passes;
    const site = siteKey(sky), time = sky.time.getTime();
    for (const object of sky.objects) {
      if (!object.satellite || object.alt < 0) continue;
      if (failed) { passes.set(object.id, packPasses([satellitePass(object.satellite, time, sky.site)]).points); continue; }
      const entry = cache.current.get(object.id);
      if (matches(entry, object.satellite, site, time) && entry!.pass.length)
        passes.set(object.id, entry!.pass);
    }
    return passes;
  }, [sky, enabled, revision, failed]);
}

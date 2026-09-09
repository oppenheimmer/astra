import { createSky, prepareSatellites } from "./sky";
import type { Catalogue, Satellite, Site } from "./types";

let satellites: Satellite[] = [];
let indices = new Map<string, number>();
const empty: Catalogue = { stars: [], messier: { features: [] }, lines: { features: [] }, constellations: { features: [] } };
self.onmessage = (event: MessageEvent) => {
  if (event.data.type === "catalogue") {
    satellites = prepareSatellites({ elements: event.data.elements, source: "CelesTrak", fetchedAt: "" });
    indices = new Map(satellites.map((s, i) => [s.id, i]));
    return;
  }
  const { time, site, siteKey } = event.data as { time: number; site: Site; siteKey: string };
  const sky = createSky(empty, satellites, new Date(time), site, false);
  const values = new Float64Array(satellites.length * 8).fill(NaN);
  for (const o of sky.objects) {
    if (!o.satellite) continue;
    const offset = indices.get(o.id)! * 8;
    values.set([o.az, o.alt, o.ra, o.dec, o.range!, o.velocity!, o.sunlit ? 1 : 0, o.stale ? 1 : 0], offset);
  }
  self.postMessage({ time, siteKey, values }, { transfer: [values.buffer] });
};

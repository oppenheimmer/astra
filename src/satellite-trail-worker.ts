import { json2satrec } from "satellite.js";
import { satellitePass } from "./satellite-pass";
import { packPasses } from "./satellite-trails";
import type { Satellite, Site } from "./types";

type Source = Omit<Satellite, "record" | "metadata">;
const sources = new Map<string, { key: string; satellite: Satellite }>();

self.onmessage = (event: MessageEvent<{ satellites: Source[]; time: number; site: Site }>) => {
  const { satellites, time, site } = event.data;
  const passes = satellites.map(source => {
    const key = JSON.stringify(source.elements);
    let saved = sources.get(source.id);
    if (!saved || saved.key !== key) {
      saved = { key, satellite: { ...source, record: json2satrec(source.elements as any) } };
      sources.set(source.id, saved);
    }
    return satellitePass(saved.satellite, time, site);
  });
  while (sources.size > 2048) sources.delete(sources.keys().next().value!);
  const packed = packPasses(passes);
  self.postMessage(packed, { transfer: [packed.points.buffer] });
};

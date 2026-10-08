import { readFileSync } from "node:fs";
import { join } from "node:path";
import { json2satrec, propagate, twoline2satrec } from "satellite.js";
import { describe, expect, it } from "vitest";
import { orbitClass } from "../src/globe";
import { parseSatelliteData } from "../src/satellite-data";
import { prepareSatellites } from "../src/sky";
import type { OrbitalElements, SatnogsMetadata } from "../src/types";

const load = (name: string) => JSON.parse(readFileSync(join(process.cwd(), "public/data", name), "utf8"));
const bundled = load("satnogs.json") as { elements: OrbitalElements[]; objects: Record<string, SatnogsMetadata> };
const fixture = load("satellites.json");
const ISS = [
  "1 25544U 98067A   26281.01472253  .00004830  00000-0  96519-4 0  9992",
  "2 25544  51.6313 101.7328 0006804 235.9979 124.0363 15.48769982589241",
];
const radio: SatnogsMetadata = {
  id: "XSKZ-5603-1870-9019-3066", name: "ISS", status: "in orbit", operator: "", countries: "RU,US",
  website: "https://www.nasa.gov/", launched: "1998-11-20", orbitSource: "",
  transmitters: 41, downlinks: [{ description: "Mode V APRS", frequency: 145825000, mode: "AFSK" }],
};
const payload = (objects: Record<string, unknown>) => ({
  ...fixture, satnogs: { fetchedAt: "2026-10-08T14:55:41Z", source: "SatNOGS DB", objects },
});

describe("SatNOGS DB in the orbital feed", () => {
  it("propagates converted elements exactly as the original two-line set", () => {
    const element = bundled.elements.find((e) => e.NORAD_CAT_ID === 25544)!;
    expect(element.EPOCH).toBe("2026-10-08T00:21:12.026592Z");
    const fromOmm = json2satrec(element), fromTle = twoline2satrec(ISS[0], ISS[1]);
    for (const hours of [0, 6, 30, 72]) {
      const date = new Date(Date.parse(element.EPOCH) + hours * 3600000);
      const a = propagate(fromOmm, date)!.position as { x: number; y: number; z: number };
      const b = propagate(fromTle, date)!.position as { x: number; y: number; z: number };
      // json2satrec reads the epoch through a Date, keeping milliseconds only: the
      // dropped 0.6 ms is about 4.5 m along the orbit, as for CelesTrak's own OMM data.
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.01);
    }
  });

  it("accepts radio details and attaches them to their satellites", () => {
    const data = parseSatelliteData(payload({ "25544": radio }))!;
    expect(data.satnogs?.objects["25544"]).toEqual(radio);
    const iss = prepareSatellites(data).find((s) => s.elements.NORAD_CAT_ID === 25544)!;
    expect(iss.satnogs).toEqual(radio);
    expect(orbitClass(iss)).toBe("station");
  });

  it("keeps SATCAT metadata and describes satellites only SatNOGS lists as payloads", () => {
    const hubble = fixture.elements.find((e: OrbitalElements) => e.NORAD_CAT_ID === 20580);
    const extra = { ...hubble, NORAD_CAT_ID: 40001, OBJECT_NAME: "CUBESAT", OBJECT_ID: "2014-033A" };
    const data = parseSatelliteData({
      ...payload({ "20580": radio, "40001": { ...radio, launched: "2014-06-19", orbitSource: "Space-Track.org" } }),
      elements: [hubble, extra],
      catalogue: { fetchedAt: "2026-09-05T00:00:00Z", source: "CelesTrak SATCAT", objects: {
        "20580": { objectType: "PAY", owner: "US", launchDate: "1990-04-24", internationalId: "1990-037B" } } },
    })!;
    const [hst, cubesat] = prepareSatellites(data);
    expect(hst.metadata?.launchDate).toBe("1990-04-24");
    expect(cubesat.metadata).toEqual({ objectType: "PAY", owner: "", launchDate: "2014-06-19", internationalId: "2014-033A" });
    expect(orbitClass(cubesat)).toBe("radio");
    expect(orbitClass(prepareSatellites({ ...data, satnogs: undefined })[1])).toBe("leo");
  });

  it("rejects the whole payload when radio details are unsafe or malformed", () => {
    for (const bad of [
      { ...radio, website: "javascript:alert(1)" },
      { ...radio, id: "<img>" },
      { ...radio, transmitters: -1 },
      { ...radio, transmitters: 1.5 },
      { ...radio, downlinks: Array(4).fill(radio.downlinks[0]) },
      { ...radio, downlinks: [{ frequency: "145.8", mode: "FM", description: "" }] },
      { ...radio, status: 3 },
    ]) expect(parseSatelliteData(payload({ "25544": bad }))).toBeNull();
    expect(parseSatelliteData(payload({ ISS: radio }))).toBeNull();
    expect(parseSatelliteData({ ...fixture, satnogs: { objects: {} } })).toBeNull();
  });

  it("bundles a snapshot the browser accepts", () => {
    const data = parseSatelliteData({ ...load("satnogs.json"), fetchedAt: "2026-10-08T14:55:41Z",
      satnogs: { fetchedAt: "2026-10-08T14:55:41Z", source: "SatNOGS DB", objects: bundled.objects } });
    expect(data?.elements.length).toBe(bundled.elements.length);
    expect(Object.keys(data!.satnogs!.objects).length).toBe(Object.keys(bundled.objects).length);
  });
});

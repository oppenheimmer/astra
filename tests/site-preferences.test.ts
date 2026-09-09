import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAGNITUDE,
  readSatelliteTrails,
  readSite,
  readStarMagnitude,
  saveSatelliteTrails,
  saveSite,
  saveStarMagnitude,
  STORAGE_KEYS,
  writeStored,
} from "../src/preferences";
import {
  isSite,
  locationLines,
  observerHeight,
  presets,
  previewSite,
  siteProblem,
  terrainKey,
  terrainParams,
} from "../src/sites";

class MemoryStorage {
  store = new Map<string, string>();
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.store.set(key, String(value));
  }
}
let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});

describe("Saved observing site", () => {
  it("restores only well-formed sites and previews Greenwich otherwise", () => {
    expect(readSite()).toBeNull();
    storage.setItem(STORAGE_KEYS.site, "{not json");
    expect(readSite()).toBeNull();
    storage.setItem(STORAGE_KEYS.site, JSON.stringify({ name: "Nowhere", lat: 91, lon: 0, elevation: 0 }));
    expect(readSite()).toBeNull();
    const bern = { ...presets[1], preview: false, heightAboveGround: 12 };
    saveSite(bern);
    expect(readSite()).toEqual(bern);
    expect(previewSite()).toEqual({ ...presets[0], preview: true });
    expect(isSite({ name: "x", lat: 0, lon: 0 })).toBe(false);
  });
  it("explains unusable coordinates, elevations and heights", () => {
    const bern = presets[1];
    expect(siteProblem(bern)).toBeNull();
    expect(siteProblem({ ...bern, lat: 95 })).toMatch(/Check latitude/);
    expect(siteProblem({ ...bern, elevation: 9500 })).toMatch(/Check latitude/);
    expect(siteProblem({ ...bern, heightAboveGround: -1 })).toMatch(/Check latitude/);
    expect(siteProblem({ ...bern, heightAboveGround: 500 })).toBeNull();
  });
  it("keys terrain requests on rounded coordinates and the default observer height", () => {
    const key = terrainKey({ name: "x", lat: 46.9480001, lon: 7.44740004, elevation: 540 });
    expect(key).toBe("46.94800,7.44740,1.5");
    expect(terrainParams(key)).toEqual({ lat: "46.94800", lon: "7.44740", height: "1.5" });
    expect(observerHeight({ heightAboveGround: 12.34 })).toBe(12.34);
    expect(observerHeight({})).toBe(1.5);
  });
  it("splits Swiss address labels into street and locality lines", () => {
    expect(locationLines("Bundesplatz 3 3011 Bern")).toEqual(["Bundesplatz 3", "3011 Bern"]);
    expect(locationLines("Bundesplatz 3, 3011 Bern")).toEqual(["Bundesplatz 3", "3011 Bern"]);
    expect(locationLines("Greenwich")).toEqual(["Greenwich"]);
  });
});

describe("Display preferences", () => {
  it("clamps the saved star magnitude and defaults when unreadable", () => {
    expect(readStarMagnitude()).toBe(DEFAULT_MAGNITUDE);
    saveStarMagnitude(12.5);
    expect(readStarMagnitude()).toBe(12.5);
    storage.setItem(STORAGE_KEYS.starMagnitude, "99");
    expect(readStarMagnitude()).toBe(14);
    storage.setItem(STORAGE_KEYS.starMagnitude, "bright");
    expect(readStarMagnitude()).toBe(DEFAULT_MAGNITUDE);
  });
  it("remembers satellite trails as an explicit all/none choice", () => {
    expect(readSatelliteTrails()).toBe(false);
    saveSatelliteTrails(true);
    expect(readSatelliteTrails()).toBe(true);
    expect(storage.getItem(STORAGE_KEYS.satelliteTrails)).toBe("all");
    saveSatelliteTrails(false);
    expect(storage.getItem(STORAGE_KEYS.satelliteTrails)).toBe("none");
  });
  it("survives storage that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("denied"); },
      setItem() { throw new Error("denied"); },
    });
    expect(() => writeStored("k", "v")).not.toThrow();
    expect(readSite()).toBeNull();
    expect(readStarMagnitude()).toBe(DEFAULT_MAGNITUDE);
  });
});

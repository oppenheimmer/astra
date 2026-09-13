import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAGNITUDE,
  readMonospaceFont,
  readSatelliteTrails,
  readSite,
  readStarMagnitude,
  saveSatelliteTrails,
  saveMonospaceFont,
  saveSite,
  saveStarMagnitude,
  STORAGE_KEYS,
  writeStored,
} from "../src/preferences";
import {
  isSite,
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
    const london = { ...presets[1], preview: false, heightAboveGround: 12 };
    saveSite(london);
    expect(readSite()).toEqual(london);
    expect(previewSite()).toEqual({ ...presets[0], preview: true });
    expect(isSite({ name: "x", lat: 0, lon: 0 })).toBe(false);
  });
  it("explains unusable coordinates, elevations and heights", () => {
    const london = presets[1];
    expect(siteProblem(london)).toBeNull();
    expect(siteProblem({ ...london, lat: 95 })).toMatch(/Check latitude/);
    expect(siteProblem({ ...london, elevation: 9500 })).toMatch(/Check latitude/);
    expect(siteProblem({ ...london, heightAboveGround: -1 })).toMatch(/Check latitude/);
    expect(siteProblem({ ...london, heightAboveGround: 500 })).toBeNull();
  });
  it("keys terrain requests on rounded coordinates and the default observer height", () => {
    const key = terrainKey({ name: "x", lat: 46.9480001, lon: 7.44740004, elevation: 540 });
    expect(key).toBe("46.94800,7.44740,1.5");
    expect(terrainParams(key)).toEqual({ lat: "46.94800", lon: "7.44740", height: "1.5" });
    expect(observerHeight({ heightAboveGround: 12.34 })).toBe(12.34);
    expect(observerHeight({})).toBe(1.5);
  });
  it("lists the default quick locations in order, with Greenwich as the preview", () => {
    expect(presets.map((preset) => preset.name)).toEqual([
      "Greenwich", "London", "Paris", "Delhi", "Beijing", "Tokyo", "Sydney", "San Francisco", "Los Angeles", "New York",
    ]);
    expect(presets.every((preset) => siteProblem(preset) === null)).toBe(true);
  });
});

describe("Display preferences", () => {
  it("restores only a supported monospace font ID", () => {
    expect(readMonospaceFont()).toBe("menlo");
    saveMonospaceFont("system");
    expect(readMonospaceFont()).toBe("system");
    storage.setItem(STORAGE_KEYS.font, "Arial; background: url(https://example.com)");
    expect(readMonospaceFont()).toBe("menlo");
    storage.setItem(STORAGE_KEYS.font, "removed-font");
    expect(readMonospaceFont()).toBe("menlo");
  });
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
    expect(readMonospaceFont()).toBe("menlo");
    expect(() => saveMonospaceFont("courier")).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SATELLITE_DATA_URL,
  fetchBundled,
  fetchDeepStars,
  fetchGaiaOverview,
  fetchGroundElevation,
  fetchHorizon,
  getJSON,
  fetchSatellites,
  searchLocations,
  validDeepStars,
  validSatelliteData,
} from "../src/api";

const respond = (status: number, body: unknown, malformed = false) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (malformed) throw new SyntaxError("Unexpected token <");
    return body;
  },
});
function mockFetch(...responses: ReturnType<typeof respond>[]) {
  const fetch = vi.fn();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("API client", () => {
  it("serialises parameters and passes request options through", async () => {
    const fetch = mockFetch(respond(200, { ok: true }));
    const controller = new AbortController();
    await getJSON("/api/thing", { lat: "46.94800", n: 2 }, "x", { signal: controller.signal });
    expect(fetch).toHaveBeenCalledWith("/api/thing?lat=46.94800&n=2", { signal: controller.signal });
  });
  it("shows the server's detail message and falls back for gateway pages or validation lists", async () => {
    mockFetch(respond(503, { detail: "Terrain is busy. Try again shortly." }));
    await expect(getJSON("/api/horizon", undefined, "Mountain outline unavailable.")).rejects.toThrow(
      "Terrain is busy. Try again shortly.",
    );
    mockFetch(respond(504, null, true));
    await expect(getJSON("/api/horizon", undefined, "Mountain outline unavailable.")).rejects.toThrow(
      "Mountain outline unavailable.",
    );
    mockFetch(respond(422, { detail: [{ loc: ["query", "lat"], msg: "too large" }] }));
    await expect(getJSON("/api/horizon", undefined, "Mountain outline unavailable.")).rejects.toThrow(
      "Mountain outline unavailable.",
    );
  });
  it("rejects terrain profiles that are not usable skylines", async () => {
    const params = { lat: "46.94800", lon: "7.44740", height: "1.5" };
    mockFetch(respond(200, { lat: 46.9, lon: 7.4, heightAboveGround: 1.5, altitudes: [1, 2] }));
    await expect(fetchHorizon(params)).rejects.toThrow("Invalid terrain data. Try again.");
    const profile = {
      lat: 46.9, lon: 7.4, heightAboveGround: 1.5, groundElevation: 540, step: 0.25,
      altitudes: Array(1440).fill(1.5), rangeKm: 200, source: "test", approximate: true,
    };
    const fetch = mockFetch(respond(200, profile));
    await expect(fetchHorizon(params)).resolves.toEqual(profile);
    expect(fetch.mock.calls[0][0]).toBe("/api/horizon?lat=46.94800&lon=7.44740&height=1.5");
  });
  it("requires a finite ground elevation and forwards Swiss grid coordinates", async () => {
    const fetch = mockFetch(respond(200, { elevation: 540, source: "swisstopo" }));
    await expect(
      fetchGroundElevation({ lat: 46.9, lon: 7.4 }, { easting: 2600000, northing: 1199000 }),
    ).resolves.toEqual({ elevation: 540, source: "swisstopo" });
    expect(fetch.mock.calls[0][0]).toBe("/api/elevation?lat=46.9&lon=7.4&easting=2600000&northing=1199000");
    mockFetch(respond(200, { elevation: null }));
    await expect(fetchGroundElevation({ lat: 46.9, lon: 7.4 })).rejects.toThrow(
      "Elevation lookup is unavailable. Enter it manually.",
    );
    mockFetch(respond(503, { detail: "Elevation lookup is unavailable. You can enter it manually." }));
    await expect(fetchGroundElevation({ lat: 46.9, lon: 7.4 })).rejects.toThrow("You can enter it manually.");
  });
  it("returns an empty address list for malformed search results", async () => {
    mockFetch(respond(200, {}));
    await expect(searchLocations("  Bundesplatz ")).resolves.toEqual([]);
    const address = { name: "Bundesplatz 3 3011 Bern", lat: 1, lon: 2, easting: 3, northing: 4 };
    const fetch = mockFetch(respond(200, { results: [address] }));
    await expect(searchLocations("  Bundesplatz ")).resolves.toEqual([address]);
    expect(fetch.mock.calls[0][0]).toBe("/api/locations/search?q=Bundesplatz");
  });
  it("validates faint-star catalogues before they reach the chart", async () => {
    const star = { id: "gaia1", ra: 1, dec: 2, mag: 12 };
    expect(validDeepStars({ stars: [star], truncated: false })).toBe(true);
    expect(validDeepStars({ stars: [{ ...star, id: "hyg1" }], truncated: false })).toBe(false);
    expect(validDeepStars({ stars: [{ ...star, mag: NaN }], truncated: false })).toBe(false);
    expect(validDeepStars({ stars: [star], truncated: "no" })).toBe(false);
    expect(validDeepStars({ stars: Array(6001).fill(star), truncated: true })).toBe(false);
    const field = { ra: 10.5, dec: -3, radius: 2, magnitude: 12 };
    const fetch = mockFetch(respond(200, { stars: [star], truncated: false }));
    await expect(fetchDeepStars(field)).resolves.toMatchObject({ stars: [star] });
    expect(fetch.mock.calls[0][0]).toBe("/api/stars/deep?ra=10.5&dec=-3&radius=2&magnitude=12");
    mockFetch(respond(200, { stars: "none" }));
    await expect(fetchDeepStars(field)).rejects.toThrow("Invalid faint-star catalogue. Try again.");
  });
  it("reads orbital elements from the published snapshot without touching the origin", async () => {
    const payload = { fetchedAt: "2026-09-09T05:00:00Z", source: "CelesTrak",
      elements: [{ NORAD_CAT_ID: 25544, EPOCH: "2026-09-09T04:00:00" }] };
    const fetch = mockFetch(respond(200, payload));
    await expect(fetchSatellites()).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(SATELLITE_DATA_URL);
  });

  it("falls back to the origin when the snapshot is unreachable or malformed", async () => {
    const payload = { fetchedAt: "2026-09-09T05:00:00Z", source: "bundled",
      elements: [{ NORAD_CAT_ID: 1, EPOCH: "2026-09-09T04:00:00" }] };
    for (const bad of [respond(503, { detail: "gone" }), respond(200, { elements: [] }), respond(200, null)]) {
      const fetch = mockFetch(bad, respond(200, payload));
      await expect(fetchSatellites()).resolves.toEqual(payload);
      expect(fetch.mock.calls.map((c) => c[0])).toEqual([SATELLITE_DATA_URL, "/api/satellites"]);
    }
    mockFetch(respond(503, { detail: "gone" }), respond(503, { detail: "also gone" }));
    await expect(fetchSatellites()).rejects.toThrow("also gone");
  });

  it("does not fall back after the caller has aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = mockFetch(respond(503, { detail: "gone" }));
    await expect(fetchSatellites(controller.signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects orbital payloads that cannot be propagated", () => {
    const ok = { fetchedAt: "t", elements: [{ NORAD_CAT_ID: 1, EPOCH: "2026-09-09T04:00:00" }] };
    expect(validSatelliteData(ok)).toBe(true);
    expect(validSatelliteData({ ...ok, elements: [] })).toBe(false);
    expect(validSatelliteData({ ...ok, fetchedAt: undefined })).toBe(false);
    expect(validSatelliteData({ ...ok, elements: [{ NORAD_CAT_ID: 1 }] })).toBe(false);
    expect(validSatelliteData({ ...ok, elements: [{ EPOCH: "t" }] })).toBe(false);
    expect(validSatelliteData(null)).toBe(false);
  });

  it("addresses bundled data and the Gaia overview by fixed paths", async () => {
    const fetch = mockFetch(
      respond(200, []),
      respond(503, { detail: "The Gaia whole-sky layer is not bundled on this server." }),
    );
    await fetchBundled("stars.json");
    await expect(fetchGaiaOverview()).rejects.toThrow("not bundled");
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(["/data/stars.json", "/api/stars/overview?v=1"]);
  });
});

import type { SatelliteData, Site, Star, TerrainProfile } from "./types";
import { validTerrain } from "./terrain";
import type { StarField } from "./star-catalogue";
import { parseSatelliteData } from "./satellite-data";

export interface Address {
  name: string;
  lat: number;
  lon: number;
  easting: number;
  northing: number;
}
export interface GroundElevation {
  elevation: number;
  source: string;
}
export interface DeepStars extends StarField {
  stars: Star[];
  truncated: boolean;
}
export interface PackedOverview {
  source: string;
  epoch: number;
  magnitude: number;
  count: number;
  rows: [string, string, number, number, number, number | null, number | null, number | null][];
}
type Params = Record<string, string | number>;

export const ELEVATION_FALLBACK = "Elevation lookup is unavailable. Enter it manually.";
export const MAX_DEEP_STARS = 6000;

/** The server's "detail" message when the error body carries one the interface can show verbatim. */
async function detailOf(response: Response) {
  try {
    const body = await response.json();
    return typeof body?.detail === "string" ? body.detail : "";
  } catch {
    return "";
  }
}

/** Fetch JSON. HTTP errors become messages; success bodies are returned for the caller to validate. */
export async function getJSON<T>(
  path: string,
  params?: Params,
  fallback = "Request failed. Try again.",
  init?: RequestInit,
): Promise<T> {
  const query = params
    ? "?" + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    : "";
  const response = await fetch(path + query, init);
  if (!response.ok) throw Error((await detailOf(response)) || fallback);
  return (await response.json()) as T;
}

export const fetchBundled = <T>(file: string) =>
  getJSON<T>(`/data/${file}`, undefined, "Catalogue could not be loaded.");

/**
 * Fresh orbital elements live in the sky-data R2 bucket, refreshed on a schedule
 * by `.github/workflows/refresh-satellites.yml` and served by the Worker in
 * `worker/`. The browser reads them directly: the CDN in front of the bucket is
 * closer and cheaper than a serverless function, and the file is already merged
 * and de-duplicated, so this replaces both the bundled snapshots and the older
 * `/api/satellites` round trip.
 */
export const SATELLITE_DATA_URL =
  "https://sky-data.globe-climatesim.workers.dev/satellites.json";

/** Enough of a payload to plot: elements that parse, with a timestamp to age them against. */
export function validSatelliteData(data: unknown): boolean {
  return parseSatelliteData(data) !== null;
}

async function satellitesFrom(source: () => Promise<unknown>) {
  const data = parseSatelliteData(await source());
  if (!data) throw Error("Invalid orbital data.");
  return data;
}

/**
 * The scheduled snapshot first, then the server's bundled copy. The fallback is
 * deliberately last and deliberately allowed to be old: the chart hides elements
 * more than a few days past their epoch rather than drawing a guessed position.
 */
export async function fetchSatellites(signal?: AbortSignal): Promise<SatelliteData> {
  try {
    return await satellitesFrom(() =>
      getJSON<unknown>(SATELLITE_DATA_URL, undefined, "Orbital data unavailable.", { signal }),
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    return satellitesFrom(() =>
      getJSON<unknown>("/api/satellites", undefined, "Orbital data unavailable.", { signal }),
    );
  }
}

export async function fetchHorizon(
  params: Record<"lat" | "lon" | "height", string | number>,
  signal?: AbortSignal,
): Promise<TerrainProfile> {
  const data = await getJSON<unknown>("/api/horizon", params, "Mountain outline unavailable.", { signal });
  if (!validTerrain(data)) throw Error("Invalid terrain data. Try again.");
  return data;
}

export async function fetchGroundElevation(
  site: Pick<Site, "lat" | "lon">,
  address?: Pick<Address, "easting" | "northing">,
  signal?: AbortSignal,
): Promise<GroundElevation> {
  const params: Params = { lat: site.lat, lon: site.lon };
  if (address) Object.assign(params, { easting: address.easting, northing: address.northing });
  const result = await getJSON<Partial<GroundElevation> | null>("/api/elevation", params, ELEVATION_FALLBACK, { signal });
  if (!result || !Number.isFinite(result.elevation)) throw Error(ELEVATION_FALLBACK);
  return { elevation: result.elevation as number, source: String(result.source ?? "") };
}

export async function searchLocations(query: string, signal?: AbortSignal): Promise<Address[]> {
  const data = await getJSON<{ results?: Address[] } | null>(
    "/api/locations/search",
    { q: query.trim() },
    "Address search unavailable.",
    { signal },
  );
  return Array.isArray(data?.results) ? data.results : [];
}

export function validDeepStars(data: unknown): data is DeepStars {
  const d = data as DeepStars;
  return (
    !!d &&
    Array.isArray(d.stars) &&
    d.stars.length <= MAX_DEEP_STARS &&
    typeof d.truncated === "boolean" &&
    d.stars.every(
      (s) =>
        typeof s?.id === "string" &&
        s.id.startsWith("gaia") &&
        Number.isFinite(s.ra) &&
        Number.isFinite(s.dec) &&
        Number.isFinite(s.mag),
    )
  );
}

export async function fetchDeepStars(field: StarField, signal?: AbortSignal): Promise<DeepStars> {
  const data = await getJSON<unknown>("/api/stars/deep", { ...field }, "Faint stars unavailable. Try again.", { signal });
  if (!validDeepStars(data)) throw Error("Invalid faint-star catalogue. Try again.");
  return data;
}

export const fetchGaiaOverview = () =>
  getJSON<PackedOverview>("/api/stars/overview", { v: 1 }, "Gaia overview unavailable. Try again.");

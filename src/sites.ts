import type { Site } from "./types";

export const presets: Site[] = [
  { name: "Greenwich", lat: 51.4779, lon: -0.0015, elevation: 46 },
  { name: "Bern", lat: 46.948, lon: 7.4474, elevation: 540 },
  { name: "Zürich", lat: 47.3769, lon: 8.5417, elevation: 408 },
  { name: "London", lat: 51.5074, lon: -0.1278, elevation: 25 },
  { name: "New York", lat: 40.7128, lon: -74.006, elevation: 10 },
  { name: "San Francisco", lat: 37.7749, lon: -122.4194, elevation: 16 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503, elevation: 40 },
  { name: "Sydney", lat: -33.8688, lon: 151.2093, elevation: 58 },
  { name: "Cape Town", lat: -33.9249, lon: 18.4241, elevation: 25 },
  { name: "Atacama", lat: -23.8634, lon: -69.1328, elevation: 2400 },
];
export const DEFAULT_HEIGHT = 1.5;

/** Greenwich stands in until the user chooses a place; the interface labels it as a preview. */
export const previewSite = (): Site => ({ ...presets[0], preview: true });

export const observerHeight = (site: Pick<Site, "heightAboveGround">) =>
  site.heightAboveGround ?? DEFAULT_HEIGHT;

const within = (value: unknown, limit: number): value is number =>
  Number.isFinite(value) && Math.abs(value as number) <= limit;

export function isSite(value: unknown): value is Site {
  const v = value as Site;
  return (
    !!v &&
    typeof v === "object" &&
    typeof v.name === "string" &&
    within(v.lat, 90) &&
    within(v.lon, 180) &&
    Number.isFinite(v.elevation) &&
    (v.heightAboveGround === undefined || Number.isFinite(v.heightAboveGround))
  );
}

/** Why a site cannot be applied, or null when every value is usable. */
export function siteProblem(site: Site): string | null {
  const height = observerHeight(site);
  const usable =
    within(site.lat, 90) &&
    within(site.lon, 180) &&
    Number.isFinite(site.elevation) &&
    site.elevation >= -500 &&
    site.elevation <= 9000 &&
    Number.isFinite(height) &&
    height >= 0 &&
    height <= 500;
  return usable ? null : "Check latitude, longitude, elevation and height above ground.";
}

/** Terrain requests are keyed on rounded coordinates so tiny drifts reuse a profile. */
export const terrainKey = (site: Site) =>
  `${site.lat.toFixed(5)},${site.lon.toFixed(5)},${observerHeight(site).toFixed(1)}`;

export function terrainParams(key: string) {
  const [lat, lon, height] = key.split(",");
  return { lat, lon, height };
}

/** Swiss address search returns one label: street, then postcode and locality. */
export function locationLines(name: string) {
  const address = name.trim().match(/^(.+?)\s*,?\s+(\d{4}\s+.+)$/);
  return address ? [address[1], address[2]] : [name];
}

import { clamp } from "./projection";
import { isSite } from "./sites";
import { DEFAULT_FONT, isMonospaceFont, type MonospaceFont } from "./fonts";
import { DEEP_MAGNITUDE } from "./star-catalogue";
import type { Theme } from "./theme";
import type { Site } from "./types";

/**
 * Keys keep their historical prefix so browsers that saved settings under the
 * earlier name keep them. index.html reads the theme key inline before React
 * loads; keep the two in step.
 */
export const STORAGE_KEYS = {
  site: "sidereal-site",
  theme: "sidereal-theme",
  starMagnitude: "sidereal-star-magnitude",
  satelliteTrails: "sidereal-satellite-trails",
  font: "sidereal-monospace-font",
} as const;
export const DEFAULT_MAGNITUDE = 6.5;

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing or a full quota: the preference simply is not remembered.
  }
}

export function readSite(): Site | null {
  try {
    const value: unknown = JSON.parse(readStored(STORAGE_KEYS.site) || "null");
    return isSite(value) ? value : null;
  } catch {
    return null;
  }
}
export const saveSite = (site: Site) => writeStored(STORAGE_KEYS.site, JSON.stringify(site));

export function readStarMagnitude() {
  const saved = readStored(STORAGE_KEYS.starMagnitude);
  const value = saved === null ? DEFAULT_MAGNITUDE : Number(saved);
  return Number.isFinite(value) ? clamp(value, -1.5, DEEP_MAGNITUDE) : DEFAULT_MAGNITUDE;
}
export const saveStarMagnitude = (magnitude: number) =>
  writeStored(STORAGE_KEYS.starMagnitude, String(magnitude));

export const readSatelliteTrails = () => readStored(STORAGE_KEYS.satelliteTrails) === "all";
export const saveSatelliteTrails = (all: boolean) =>
  writeStored(STORAGE_KEYS.satelliteTrails, all ? "all" : "none");

export function readMonospaceFont(): MonospaceFont {
  const saved = readStored(STORAGE_KEYS.font);
  return isMonospaceFont(saved) ? saved : DEFAULT_FONT;
}
export const saveMonospaceFont = (font: MonospaceFont) => writeStored(STORAGE_KEYS.font, font);

export const saveTheme = (theme: Theme) => writeStored(STORAGE_KEYS.theme, theme);
/** index.html applies the saved theme before the first paint; React starts from that. */
export const initialTheme = (): Theme =>
  document.documentElement.dataset.theme === "dark" ? "dark" : "light";

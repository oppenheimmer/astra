import type { OrbitClass } from "./globe";
import { clamp } from "./projection";

export type Theme = "light" | "dark";
export const skyPalette = {
  light: {
    ink: "#30312d",
    muted: "#53554e",
    dim: "#8b8e84",
    grid: "#d3d3cd",
    constellation: "#c1c2bb",
    rim: "#83877c",
    starBright: "#252722",
    starMedium: "#44483f",
    starFaint: "#62665c",
    object: "#585f50",
    satelliteBracket: "#38955f",
    satelliteDot: "#cc000a",
    trail: "#818876",
    terrain: "#d7d6cf",
    terrainEdge: "#7d7d74",
    sun: "#353530",
    moon: "#86867d",
    label: "rgba(255,255,255,.96)",
  },
  dark: {
    ink: "#d8e1ea",
    muted: "#adbac7",
    dim: "#768390",
    grid: "#373e47",
    constellation: "#545d68",
    rim: "#768390",
    starBright: "#e6edf3",
    starMedium: "#cdd9e5",
    starFaint: "#adbac7",
    object: "#adbac7",
    satelliteBracket: "#64ce72",
    satelliteDot: "#ff4d5a",
    trail: "#909dab",
    terrain: "#2d333b",
    terrainEdge: "#636e7b",
    sun: "#e6edf3",
    moon: "#909dab",
    label: "rgba(34,39,46,.96)",
  },
};

export type SatelliteShape =
  "dot" | "square" | "ring" | "diamond" | "triangle" | "cross" | "plus" | "box" | "target" | "station";
/**
 * Globe inks. Earth's lines stay neutral and quiet; satellites take bright hues
 * that read against them, and differ by shape as well for readers who cannot
 * separate the colours. Red and green are the sky chart's own satellite inks;
 * the other hues come from the GitHub Primer families the dark theme is built
 * on. `halo` is the page background, used to knock each symbol out of the lines
 * beneath it.
 */
export const globePalette: Record<Theme, Record<OrbitClass | "coast" | "halo" | "deep", string>> = {
  light: {
    coast: "#a4a79c", halo: "#ffffff", deep: "#30312d",
    station: "#38955f", radio: "#bc4c00", leo: "#cc000a", starlink: "#0969da",
    meo: "#8250df", geo: "#9a6700", heo: "#30312d",
    inactive: "#57606a", rocket: "#1b7c83", debris: "#bf3989",
  },
  dark: {
    coast: "#636e7b", halo: "#22272e", deep: "#d8e1ea",
    station: "#64ce72", radio: "#f69d50", leo: "#ff4d5a", starlink: "#6cb6ff",
    meo: "#b083f0", geo: "#daaa3f", heo: "#d8e1ea",
    inactive: "#adbac7", rocket: "#56d4dd", debris: "#e275ad",
  },
};
/** Symbol shape and size in CSS pixels at the home zoom. */
export const satelliteSymbols: Record<OrbitClass, { shape: SatelliteShape; size: number }> = {
  station: { shape: "station", size: 3.4 },
  radio: { shape: "cross", size: 4.2 },
  leo: { shape: "square", size: 2.8 },
  starlink: { shape: "dot", size: 2.4 },
  meo: { shape: "ring", size: 4.6 },
  geo: { shape: "diamond", size: 5 },
  heo: { shape: "triangle", size: 5 },
  inactive: { shape: "box", size: 3.6 },
  rocket: { shape: "plus", size: 4.4 },
  debris: { shape: "dot", size: 2.2 },
};
/** Spacecraft beyond Earth orbit, from JPL Horizons. */
export const deepSpaceSymbol = { shape: "target" as SatelliteShape, size: 7 };

/** Display symbols, enlarged at close zoom so even G 14 stays legible. */
export function starRadius(magnitude: number, field: number) {
  const detail = clamp(Math.log2(20 / field) / 3, 0, 1);
  return clamp(3 - magnitude * 0.3, 0.9, 3.8) + detail * 0.25;
}

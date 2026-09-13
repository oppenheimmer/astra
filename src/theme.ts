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

/** Display symbols, enlarged at close zoom so even G 14 stays legible. */
export function starRadius(magnitude: number, field: number) {
  const detail = clamp(Math.log2(20 / field) / 3, 0, 1);
  return clamp(3 - magnitude * 0.3, 0.9, 3.8) + detail * 0.25;
}

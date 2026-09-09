import { clamp } from "./projection";

export type Theme = "light" | "dark";
export const skyPalette = {
  light: {
    ink: "#30312d",
    muted: "#64665e",
    dim: "#8b8e84",
    grid: "#d3d3cd",
    constellation: "#c1c2bb",
    rim: "#83877c",
    starBright: "#252722",
    starMedium: "#44483f",
    starFaint: "#62665c",
    object: "#585f50",
    satellite: "#4e5747",
    shadow: "#9c9f95",
    trail: "#818876",
    terrain: "#d7d6cf",
    terrainEdge: "#7d7d74",
    sun: "#353530",
    moon: "#86867d",
    label: "rgba(238,237,232,.96)",
  },
  dark: {
    ink: "#e4e6dd",
    muted: "#b0b5a7",
    dim: "#7f8677",
    grid: "#30362d",
    constellation: "#464c3f",
    rim: "#707867",
    starBright: "#f2f4eb",
    starMedium: "#e0e4d8",
    starFaint: "#c4c8bb",
    object: "#b9c1ae",
    satellite: "#d5dccb",
    shadow: "#77816d",
    trail: "#878f7c",
    terrain: "#22251e",
    terrainEdge: "#596151",
    sun: "#ececda",
    moon: "#9ba392",
    label: "rgba(20,21,19,.96)",
  },
};

/** Display symbols, enlarged at close zoom so even G 14 stays legible. */
export function starRadius(magnitude: number, field: number) {
  const detail = clamp(Math.log2(20 / field) / 3, 0, 1);
  return clamp(3 - magnitude * 0.3, 0.9, 3.8) + detail * 0.25;
}

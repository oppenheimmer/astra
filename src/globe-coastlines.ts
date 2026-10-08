import { earthLand } from "./earth-land";
import { surfaceLine } from "./globe";

let coastlines: Float64Array[] | null = null;
/**
 * Natural Earth 1:110m land outlines as unit vectors, recovered from the
 * equirectangular chart coordinates `scripts/build_earth_land.py` writes.
 * Kept apart from the globe helpers so the outlines load only with the globe.
 */
export function globeCoastlines() {
  if (coastlines) return coastlines;
  coastlines = earthLand.flatMap((path) =>
    path
      .split("M")
      .filter(Boolean)
      .map((ring) =>
        surfaceLine(
          ring
            .replace("Z", "")
            .split("L")
            .map((pair) => {
              const [x, y] = pair.split(",").map(Number);
              return [((94 - y) / 70) * 90, ((x - 150) / 133) * 180] as [number, number];
            }),
        ),
      ),
  );
  return coastlines;
}

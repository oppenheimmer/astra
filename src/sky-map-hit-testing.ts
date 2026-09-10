import type { SkyObject } from "./types";

export type MapPoint = { x: number; y: number };
export type PlottedObject = MapPoint & {
  o: SkyObject;
  r: number;
  disk?: Path2D;
};

/** Filled solar/lunar limbs cover stars; other symbols use nearest-edge distance. */
export function hitSkyObject(
  points: PlottedObject[],
  position: MapPoint,
  tolerance: number,
  inside: (x: number, y: number) => boolean,
  context?: CanvasRenderingContext2D | null,
): PlottedObject | null {
  if (!inside(position.x, position.y)) return null;
  if (context) {
    context.save();
    // Paths and pointer coordinates are CSS pixels, independent of device scale.
    context.resetTransform();
    const disk = points.find(q => q.disk && context.isPointInPath(q.disk, position.x, position.y));
    context.restore();
    if (disk) return disk;
  }
  let nearest: PlottedObject | null = null;
  let distance = tolerance;
  for (const point of points) {
    const edgeDistance = Math.max(0, Math.hypot(point.x - position.x, point.y - position.y) -
      (point.disk ? Math.min(point.r, 2) : point.r));
    if (edgeDistance < distance) {
      distance = edgeDistance;
      nearest = point;
    }
  }
  return nearest;
}

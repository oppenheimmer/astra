import { angularLimb, type createProjector } from "./projection";
import { horizonAltitude } from "./terrain";
import { passSplit } from "./satellite-trails";
import { starRadius, type skyPalette, type Theme } from "./theme";
import type { Layers, Sky, SkyObject, TerrainProfile, View } from "./types";
import type { PlottedObject } from "./sky-map-hit-testing";

type Projector = ReturnType<typeof createProjector>;
type Colors = (typeof skyPalette)[Theme];

/** Draw object symbols in catalogue order and return their exact hit targets. */
export function drawSkyObjects(
  c: CanvasRenderingContext2D,
  p: { sky: Sky; view: View; layers: Layers; starMagnitude: number },
  geometry: { getPoint: Projector; cx: number; cy: number; r: number; aspect: number },
  terrain: TerrainProfile | null,
  colors: Colors,
): PlottedObject[] {
  const { getPoint, cx, cy, r, aspect } = geometry;
  const active = (o: SkyObject) =>
    o.kind === "star"
      ? p.layers.star
      : o.kind === "planet"
        ? p.layers.planet
        : o.kind === "satellite"
          ? p.layers.satellite
          : p.layers.galaxy;
  const plotted: PlottedObject[] = [];
  const starGroups = new Map<string, { x: number; y: number; r: number }[]>();
  const paintStars = () => {
    for (const [color, group] of starGroups) {
      c.fillStyle = color;
      c.beginPath();
      for (const point of group) {
        c.moveTo(point.x + point.r, point.y);
        c.arc(point.x, point.y, point.r, 0, Math.PI * 2);
      }
      c.fill();
    }
    starGroups.clear();
  };
  for (const o of p.sky.objects) {
    // createSky places stars first. Batch their fills, then paint disks and
    // other objects above them, retaining individual hit targets and radii.
    if (o.kind !== "star" && starGroups.size) paintStars();
    if (
      o.alt + (o.angularDiameter || 0) / 2 < 0 ||
      // Stars remain visible through the translucent terrain drawn below.
      (terrain && o.kind !== "star" &&
        o.alt + (o.angularDiameter || 0) / 2 <
          horizonAltitude(terrain, o.az)) ||
      !active(o) ||
      (o.kind === "star" && o.mag > p.starMagnitude)
    )
      continue;
    const s = getPoint(o.az, o.alt);
    if (!s || (!s.inside && !o.angularDiameter)) continue;
    let radius = 1;
    let disk: Path2D | undefined;
    if (o.angularDiameter) {
      const limb = angularLimb(o.az, o.alt, o.angularDiameter)
        .map((h) => getPoint(h.az, h.alt))
        .filter((q): q is NonNullable<typeof q> => !!q);
      if (!limb.length) continue;
      radius = Math.max(...limb.map((q) => Math.hypot(q.x - s.x, q.y - s.y)));
      const xs = limb.map((q) => q.x),
        ys = limb.map((q) => q.y);
      if (
        Math.max(...xs) < cx - r * aspect ||
        Math.min(...xs) > cx + r * aspect ||
        Math.max(...ys) < cy - r ||
        Math.min(...ys) > cy + r
      )
        continue;
      c.fillStyle = o.id === "Sun" ? colors.sun : colors.moon;
      disk = new Path2D();
      limb.forEach((q, i) =>
        i ? disk!.lineTo(q.x, q.y) : disk!.moveTo(q.x, q.y),
      );
      disk.closePath();
      c.fill(disk);
    } else if (o.kind === "star") {
      radius = starRadius(o.mag, p.view.mode === "allsky" ? 180 : p.view.fov);
      const color =
        o.mag < 2
          ? colors.starBright
          : o.mag < 7.5
            ? colors.starMedium
            : colors.starFaint;
      const group = starGroups.get(color) ?? [];
      group.push({ x: s.x, y: s.y, r: radius });
      starGroups.set(color, group);
      if (o.mag < 1) {
        c.strokeStyle = colors.muted;
        c.lineWidth = 0.6;
        c.beginPath();
        c.moveTo(s.x - 5, s.y);
        c.lineTo(s.x + 5, s.y);
        c.moveTo(s.x, s.y - 5);
        c.lineTo(s.x, s.y + 5);
        c.stroke();
      }
    } else if (o.kind === "planet") {
      radius = 4;
      c.strokeStyle = colors.object;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(s.x, s.y, radius + 4, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = colors.object;
      c.beginPath();
      c.arc(s.x, s.y, 2, 0, Math.PI * 2);
      c.fill();
    } else if (o.kind === "satellite") {
      radius = 4;
      c.fillStyle = o.sunlit ? colors.satellite : colors.shadow;
      c.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    } else {
      radius = 5;
      c.strokeStyle = colors.object;
      c.lineWidth = 0.8;
      c.beginPath();
      if (o.kind === "galaxy") {
        radius = 5.5;
        c.setLineDash([3, 2.5]);
        c.arc(s.x, s.y, radius, 0, Math.PI * 2);
      } else if (o.kind === "cluster") {
        c.setLineDash([1.3, 2]);
        c.arc(s.x, s.y, 5, 0, Math.PI * 2);
      } else {
        c.moveTo(s.x, s.y - 5);
        c.lineTo(s.x + 5, s.y);
        c.lineTo(s.x, s.y + 5);
        c.lineTo(s.x - 5, s.y);
        c.closePath();
      }
      c.stroke();
      c.setLineDash([]);
    }
    plotted.push({ o, x: s.x, y: s.y, r: radius, disk });
  }
  paintStars();
  return plotted;
}

/** Trails share the same projected objects as symbols, labels and hit testing. */
export function drawSatelliteTrails(
  c: CanvasRenderingContext2D,
  p: { sky: Sky; layers: Layers; satelliteTrails: boolean },
  plotted: PlottedObject[],
  satelliteTrails: Map<string, Float64Array>,
  getPoint: Projector,
  colors: Colors,
) {
  if (p.layers.satellite && p.satelliteTrails) {
    const sats = plotted.filter((q) => q.o.kind === "satellite");
    for (const q of sats) {
      const time = p.sky.time.getTime();
      const pass = satelliteTrails.get(q.o.id);
      if (!pass) continue;
      const split = passSplit(pass, time);
      const strokeTrail = (future: boolean) => {
        c.strokeStyle = colors.trail;
        c.lineWidth = 0.9;
        c.setLineDash(future ? [3, 4] : []);
        c.beginPath();
        let previous = false;
        const point = (az: number, alt: number) => {
          const s = getPoint(az, alt);
          if (!s || alt < 0) { previous = false; return; }
          if (previous) c.lineTo(s.x, s.y);
          else c.moveTo(s.x, s.y);
          previous = true;
        };
        if (future) point(q.o.az, q.o.alt);
        const start = future ? split + (pass[split] === time ? 3 : 0) : 0;
        for (let i = start; i < (future ? pass.length : split); i += 3)
          point(pass[i + 1], pass[i + 2]);
        if (!future) point(q.o.az, q.o.alt);
        c.stroke();
      };
      strokeTrail(false);
      strokeTrail(true);
    }
    c.setLineDash([]);
  }
}

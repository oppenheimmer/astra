import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  Layers,
  Sky,
  SkyObject,
  Telescope,
  TerrainProfile,
  View,
} from "./types";
import { horizonAltitude } from "./terrain";
import {
  anchorDirection,
  angularLimb,
  clamp,
  compass,
  createProjector,
  PERSONAL_ASPECT,
  personalBoundary,
  unproject,
  wrap,
  zoomAt,
} from "./projection";
import { distanceLabel, equatorialToHorizontal } from "./sky";
import { passSplit } from "./satellite-trails";
import { useSatelliteTrails } from "./useSatelliteTrails";
import { skyPalette, starRadius, type Theme } from "./theme";

interface Props {
  theme: Theme;
  sky: Sky;
  view: View;
  setView: Dispatch<SetStateAction<View>>;
  layers: Layers;
  satelliteTrails: boolean;
  highlights: SkyObject[];
  selected: SkyObject | null;
  select: (o: SkyObject) => void;
  telescope: Telescope;
  aiming: boolean;
  aim: (az: number, alt: number) => void;
  showHighlights: boolean;
  terrain: TerrainProfile | null;
  starMagnitude: number;
}
type PlottedObject = {
  o: SkyObject;
  x: number;
  y: number;
  r: number;
  disk?: Path2D;
};
export default function SkyMap(p: Props) {
  const colors = skyPalette[p.theme];
  const satelliteTrails = useSatelliteTrails(p.sky, p.layers.satellite && p.satelliteTrails);
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    overlay = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 700 }),
    [isDragging, setDragging] = useState(false),
    [hover, setHover] = useState<{
      object: SkyObject;
      x: number;
      y: number;
    } | null>(null);
  const points = useRef<PlottedObject[]>([]),
    drag = useRef<{
      x: number;
      y: number;
      az: number;
      alt: number;
      moved: boolean;
      id: number;
      objectId?: string;
      field: boolean;
      view: View;
    } | null>(null),
    pinch = useRef(new Map<number, { x: number; y: number }>());
  const personal = p.view.mode === "personal",
    bottom = 110,
    cx = size.w / 2,
    cy = personal ? (72 + size.h - bottom) / 2 : size.h / 2,
    r = personal
      ? Math.max(
          40,
          Math.min(
            (size.h - bottom - 72) / 2,
            (size.w - 60) / (2 * PERSONAL_ASPECT),
          ),
        )
      : Math.max(40, Math.min(size.w / 2 - 34, size.h / 2 - 36)),
    aspect = personal ? PERSONAL_ASPECT : 1;
  const getPoint = createProjector(p.view, cx, cy, r, aspect);
  const terrain = personal ? p.terrain : null;
  const outline = personal
    ? personalBoundary(p.view.az).map((h) => getPoint(h.az, h.alt)!)
    : [];
  const skyline = () =>
    Array.from({ length: 721 }, (_, i) => {
      const az = p.view.az - 45 + i / 8;
      return getPoint(az, horizonAltitude(terrain!, az))!;
    });
  const landBand = (rim: { x: number; y: number }[]) => [
    ...rim,
    ...Array.from({ length: 181 }, (_, i) =>
      getPoint(p.view.az + 45 - i / 2, 0)!,
    ),
  ];
  const trace = (
    path: CanvasRenderingContext2D | Path2D,
    points: { x: number; y: number }[],
  ) => {
    points.forEach((q, i) =>
      i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y),
    );
    path.closePath();
  };
  const aboveTerrain = (x: number, y: number) => {
    if (!terrain) return true;
    const h = unproject(x, y, p.view, cx, cy, r, true, aspect)!;
    return h.alt >= horizonAltitude(terrain, h.az);
  };
  const boundary = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    if (personal) trace(c, outline);
    else c.arc(cx, cy, r, 0, Math.PI * 2);
  };
  const clipViewport = (c: CanvasRenderingContext2D) => {
    if (!personal) return;
    c.beginPath();
    c.rect(cx - r * aspect, cy - r, 2 * r * aspect, 2 * r);
    c.clip();
  };
  const inside = (x: number, y: number, margin = 0) =>
    personal
      ? Math.abs(x - cx) <= r * aspect - margin &&
        Math.abs(y - cy) <= r - margin &&
        !!unproject(x, y, p.view, cx, cy, r, false, aspect)
      : Math.hypot(x - cx, y - cy) <= r - margin;
  useEffect(
    () => setHover(null),
    [p.view, p.selected?.id, p.starMagnitude, p.terrain],
  );
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    ro.observe(host.current);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== Math.round(size.w * dpr))
      el.width = Math.round(size.w * dpr);
    if (el.height !== Math.round(size.h * dpr))
      el.height = Math.round(size.h * dpr);
    const c = el.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size.w, size.h);
    const font = "11px Departure, monospace";
    c.font = font;
    c.textBaseline = "middle";
    c.save();
    clipViewport(c);
    boundary(c);
    c.clip();
    const strokePath = (
      path: { az: number; alt: number }[],
      color: string,
      width: number,
      dash: number[] = [],
      clipCurve = false,
    ) => {
      c.strokeStyle = color;
      c.lineWidth = width;
      c.setLineDash(dash);
      c.beginPath();
      let prev: { x: number; y: number } | null = null;
      for (const q of path) {
        const s = q.alt >= 0 ? getPoint(q.az, q.alt) : null;
        if (!s || (!clipCurve && !s.inside)) {
          prev = null;
          continue;
        }
        if (
          prev &&
          (clipCurve || Math.hypot(prev.x - s.x, prev.y - s.y) < r * 0.3)
        )
          c.lineTo(s.x, s.y);
        else c.moveTo(s.x, s.y);
        prev = s;
      }
      c.stroke();
      c.setLineDash([]);
    };
    if (p.layers.grid) {
      for (let alt = 0; alt < 90; alt += 15)
        strokePath(
          Array.from({ length: 361 }, (_, az) => ({ az, alt })),
          alt === 0 ? colors.dim : colors.grid,
          alt === 0 ? 1 : 0.65,
          alt === 0 ? [] : [2, 4],
        );
      for (let az = 0; az < 360; az += 30)
        strokePath(
          Array.from({ length: 91 }, (_, alt) => ({ az, alt })),
          colors.grid,
          0.65,
          [2, 4],
        );
    }
    if (p.layers.constellation) {
      for (const line of p.sky.lines)
        for (const segment of line.points)
          strokePath(
            segment.filter((a) => a.alt >= 0),
            colors.constellation,
            0.8,
          );
    }
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
    points.current = plotted;
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
    if (terrain) {
      const rim = skyline();
      c.save();
      c.beginPath();
      trace(c, landBand(rim));
      c.fillStyle = colors.terrain;
      c.globalAlpha = 0.65;
      c.fill();
      c.clip();
      // Fine screen-space hatching keeps the terrain legible at any zoom.
      c.globalAlpha = 0.3;
      c.strokeStyle = colors.terrainEdge;
      c.lineWidth = 0.6;
      c.beginPath();
      for (let x = cx - r * aspect - 2 * r; x < cx + r * aspect; x += 7) {
        c.moveTo(x, cy + r);
        c.lineTo(x + 2 * r, cy - r);
      }
      c.stroke();
      c.restore();
      c.beginPath();
      rim.forEach((q, i) => (i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)));
      c.strokeStyle = colors.terrainEdge;
      c.lineWidth = 1.2;
      c.stroke();
    }
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const highlightIds = new Set(p.highlights.map(h => h.id));
    const candidates = plotted
      .filter((q) =>
        q.o.id === p.selected?.id ||
        ((!terrain || q.o.alt >= horizonAltitude(terrain, q.o.az)) &&
          (!!q.o.angularDiameter ||
            (p.showHighlights && highlightIds.has(q.o.id)))),
      )
      .sort((a, b) =>
        a.o.id === p.selected?.id
          ? -1
          : b.o.id === p.selected?.id
            ? 1
            : a.o.mag - b.o.mag,
      );
    for (const q of candidates) {
      const selected = q.o.id === p.selected?.id,
        tag = q.o.catalogue
          ? `${q.o.catalogue} ${q.o.name === q.o.catalogue ? "" : q.o.name}`.trim()
          : q.o.name;
      const label = tag.length > 25 ? tag.slice(0, 24) + "…" : tag;
      const width = c.measureText(label).width + 8;
      const offset = Math.max(12, q.r + 7);
      const positions = [
        { x: q.x + offset, y: q.y - 11 },
        { x: q.x - width - offset, y: q.y - 11 },
        { x: q.x + offset, y: q.y + 13 },
        { x: q.x - width - offset, y: q.y + 13 },
      ];
      const placement = positions.find(
        ({ x, y }) =>
          [
            [x - 3, y - 8],
            [x + width, y - 8],
            [x - 3, y + 8],
            [x + width, y + 8],
          ].every(([px, py]) => inside(px, py, 4) && aboveTerrain(px, py)) &&
          !boxes.some(
            (b) =>
              x < b.x + b.w &&
              x + width > b.x &&
              y - 8 < b.y + b.h &&
              y + 8 > b.y,
          ),
      );
      if (!placement && !selected) continue;
      const { x, y } = placement || positions[0];
      boxes.push({ x, y: y - 8, w: width, h: 16 });
      c.fillStyle = colors.label;
      c.fillRect(x - 3, y - 8, width, 16);
      c.fillStyle = selected ? colors.ink : colors.muted;
      c.fillText(label, x, y);
      if (selected) {
        c.strokeStyle = colors.ink;
        c.lineWidth = 1;
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          c.beginPath();
          c.moveTo(q.x + sx * offset, q.y + sy * (offset - 6));
          c.lineTo(q.x + sx * offset, q.y + sy * offset);
          c.lineTo(q.x + sx * (offset - 6), q.y + sy * offset);
          c.stroke();
        }
      }
    }
    c.restore();
    c.strokeStyle = colors.rim;
    c.lineWidth = 1;
    c.save();
    clipViewport(c);
    boundary(c);
    c.stroke();
    c.restore();
    for (let i = 0; !personal && i < 72; i++) {
      const a = (i * Math.PI) / 36;
      c.strokeStyle = i % 6 === 0 ? colors.rim : colors.constellation;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (r + 3), cy + Math.sin(a) * (r + 3));
      c.lineTo(
        cx + Math.cos(a) * (r + (i % 6 === 0 ? 9 : 5)),
        cy + Math.sin(a) * (r + (i % 6 === 0 ? 9 : 5)),
      );
      c.stroke();
    }
    c.fillStyle = colors.muted;
    c.textAlign = "center";
    if (personal) {
      c.font = "9px Departure, monospace";
      for (let i = 0; i <= 4; i++) {
        const az = wrap(p.view.az + (i - 2) * 22.5),
          point = getPoint(az, 0);
        if (!point?.inside) continue;
        c.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
        c.fillText(`${compass(az)} ${az.toFixed(0)}°`, point.x, point.y + 17);
      }
      for (const alt of [15, 30, 60]) {
        const point = getPoint(p.view.az - 45, alt);
        if (!point?.inside) continue;
        c.textAlign = "right";
        c.fillText(`${alt}°`, point.x - 8, point.y);
      }
      c.textAlign = "center";
      const zenith = getPoint(p.view.az, 90),
        horizon = getPoint(p.view.az, 0);
      c.fillText(
        zenith?.inside ? "ZENITH 90°" : "↑ ZENITH",
        cx,
        zenith?.inside ? zenith.y - 12 : cy - r - 12,
      );
      c.fillText(
        horizon?.inside ? "HORIZON" : "↓ HORIZON",
        cx,
        horizon?.inside ? horizon.y + 33 : cy + r + 33,
      );
    } else if (p.view.mode === "allsky") {
      c.fillText("N", cx, cy - r - 23);
      c.fillText("S", cx, cy + r + 23);
      c.fillText("E", cx - r - 22, cy);
      c.fillText("W", cx + r + 22, cy);
    } else {
      for (const [az, txt] of [
        [0, "N"],
        [45, "NE"],
        [90, "E"],
        [135, "SE"],
        [180, "S"],
        [225, "SW"],
        [270, "W"],
        [315, "NW"],
      ] as [number, string][]) {
        const s = getPoint(az, 0);
        if (s?.inside) c.fillText(txt, s.x, s.y + 15);
      }
      c.save();
      c.translate(cx, cy);
      c.rotate(((p.view.roll || 0) * Math.PI) / 180);
      c.fillText("ZENITH ↑", 0, -r - 23);
      c.restore();
    }
    c.textAlign = "left";
    c.strokeStyle = colors.dim;
    c.beginPath();
    c.moveTo(cx - 5, cy);
    c.lineTo(cx + 5, cy);
    c.moveTo(cx, cy - 5);
    c.lineTo(cx, cy + 5);
    c.stroke();
  }, [
    p.sky,
    p.view,
    p.layers,
    p.satelliteTrails,
    satelliteTrails,
    p.highlights,
    p.selected?.id,
    p.showHighlights,
    p.terrain,
    p.starMagnitude,
    p.theme,
    p.telescope.connected,
    size,
  ]);
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== Math.round(size.w * dpr))
      el.width = Math.round(size.w * dpr);
    if (el.height !== Math.round(size.h * dpr))
      el.height = Math.round(size.h * dpr);
    const c = el.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const skyMask = new Path2D();
    if (terrain) {
      trace(skyMask, outline);
      trace(skyMask, landBand(skyline()));
    }
    let frame = 0;
    const draw = (now: number) => {
      c.clearRect(0, 0, size.w, size.h);
      c.save();
      clipViewport(c);
      boundary(c);
      c.clip();
      if (terrain) c.clip(skyMask, "evenodd");
      if (p.layers.satellite) {
        c.globalAlpha = window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches
          ? 1
          : 0.6 + 0.4 * Math.sin(now / 500) ** 2;
        c.strokeStyle = colors.satellite;
        c.lineWidth = 1;
        for (const q of points.current.filter(
          (q) => q.o.kind === "satellite",
        )) {
          const n = 6;
          c.beginPath();
          c.moveTo(q.x - 3, q.y - n);
          c.lineTo(q.x - n, q.y - n);
          c.lineTo(q.x - n, q.y + n);
          c.lineTo(q.x - 3, q.y + n);
          c.moveTo(q.x + 3, q.y - n);
          c.lineTo(q.x + n, q.y - n);
          c.lineTo(q.x + n, q.y + n);
          c.lineTo(q.x + 3, q.y + n);
          c.stroke();
        }
        c.globalAlpha = 1;
      }
      if (p.telescope.connected) {
        const t = p.telescope,
          h = equatorialToHorizontal(t.ra, t.dec, p.sky.time, p.sky.site),
          center = getPoint(h.az, h.alt);
        c.strokeStyle = colors.ink;
        c.lineWidth = 1.2;
        const rim = [];
        for (let i = 0; i <= 80; i++) {
          const a = (i / 80) * Math.PI * 2;
          const dx =
            t.shape === "circle"
              ? (Math.cos(a) * t.width) / 2
              : ((Math.cos(a) /
                  Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)))) *
                  t.width) /
                2;
          const dy =
            t.shape === "circle"
              ? (Math.sin(a) * t.width) / 2
              : ((Math.sin(a) /
                  Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)))) *
                  t.height) /
                2;
          const hh = equatorialToHorizontal(
            t.ra +
              dx / (15 * Math.max(0.02, Math.cos((t.dec * Math.PI) / 180))),
            clamp(t.dec + dy, -89.99, 89.99),
            p.sky.time,
            p.sky.site,
          );
          rim.push(getPoint(hh.az, hh.alt));
        }
        c.beginPath();
        let prev = false;
        for (const q of rim) {
          if (!q?.inside) {
            prev = false;
            continue;
          }
          if (prev) c.lineTo(q.x, q.y);
          else c.moveTo(q.x, q.y);
          prev = true;
        }
        c.stroke();
        if (center?.inside) {
          c.setLineDash([2, 3]);
          c.beginPath();
          c.arc(center.x, center.y, 16, 0, Math.PI * 2);
          c.stroke();
          c.setLineDash([]);
          c.beginPath();
          c.moveTo(center.x - 25, center.y);
          c.lineTo(center.x - 19, center.y);
          c.moveTo(center.x + 19, center.y);
          c.lineTo(center.x + 25, center.y);
          c.moveTo(center.x, center.y - 25);
          c.lineTo(center.x, center.y - 19);
          c.moveTo(center.x, center.y + 19);
          c.lineTo(center.x, center.y + 25);
          c.stroke();
          c.font = "10px Departure, monospace";
          c.fillStyle = colors.ink;
          c.fillText(
            t.moving ? "SLEWING" : "TELESCOPE",
            center.x + 22,
            center.y + 26,
          );
        }
        if (t.moving) {
          const th = equatorialToHorizontal(
              t.targetRa,
              t.targetDec,
              p.sky.time,
              p.sky.site,
            ),
            target = getPoint(th.az, th.alt);
          if (center?.inside && target?.inside) {
            c.setLineDash([2, 5]);
            c.strokeStyle = colors.dim;
            c.beginPath();
            c.moveTo(center.x, center.y);
            c.lineTo(target.x, target.y);
            c.stroke();
            c.setLineDash([]);
            c.strokeRect(target.x - 5, target.y - 5, 10, 10);
          }
        }
      }
      c.restore();
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [
    p.telescope,
    p.sky.time,
    p.sky.site,
    p.view,
    p.layers.satellite,
    p.terrain,
    p.theme,
    size,
  ]);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta =
        e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1);
      const rect = node.getBoundingClientRect();
      // Trackpad events can arrive before React commits the preceding event.
      // Apply each delta to the latest queued camera, never a render's old view.
      p.setView((view) =>
        zoomAt(
          view,
          (view.mode === "allsky" ? 150 : view.fov) * Math.exp(delta * 0.0015),
          e.clientX - rect.left,
          e.clientY - rect.top,
          cx,
          cy,
          r,
          aspect,
        ),
      );
      setHover(null);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [p.setView, size, cx, cy, r, aspect]);
  const position = (e: React.PointerEvent) => {
    const b = host.current!.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const hitObject = (pos: { x: number; y: number }, tolerance: number) => {
    if (!inside(pos.x, pos.y)) return null;
    const c = canvas.current?.getContext("2d");
    // Use the filled limb, so an enlarged disk covers stars and stays clickable at any zoom.
    if (c) {
      c.save();
      c.resetTransform();
      const disk = points.current.find(
        (q) => q.disk && c.isPointInPath(q.disk, pos.x, pos.y),
      );
      c.restore();
      if (disk) return disk;
    }
    let nearest: PlottedObject | null = null,
      dist = tolerance;
    for (const q of points.current) {
      const dd = Math.max(
        0,
        Math.hypot(q.x - pos.x, q.y - pos.y) -
          (q.disk ? Math.min(q.r, 2) : q.r),
      );
      if (dd < dist) {
        dist = dd;
        nearest = q;
      }
    }
    return nearest;
  };
  const pointerDown = (e: React.PointerEvent) => {
    const pos = position(e);
    if (!inside(pos.x, pos.y)) return;
    pinch.current.set(e.pointerId, pos);
    host.current?.setPointerCapture(e.pointerId);
    const h = p.telescope.connected
      ? equatorialToHorizontal(
          p.telescope.ra,
          p.telescope.dec,
          p.sky.time,
          p.sky.site,
        )
      : null;
    const field = h ? getPoint(h.az, h.alt) : null;
    drag.current = {
      ...pos,
      az: p.view.az,
      alt: p.view.alt,
      moved: false,
      id: e.pointerId,
      objectId: hitObject(pos, e.pointerType === "touch" ? 24 : 16)?.o.id,
      view: p.view,
      field:
        !!field?.inside && Math.hypot(pos.x - field.x, pos.y - field.y) < 26,
    };
    setHover(null);
    setDragging(false);
  };
  const pointerMove = (e: React.PointerEvent) => {
    const pos = position(e);
    if (pinch.current.size === 2 && pinch.current.has(e.pointerId)) {
      const old = [...pinch.current.values()],
        before = Math.hypot(old[0].x - old[1].x, old[0].y - old[1].y);
      pinch.current.set(e.pointerId, pos);
      const after = [...pinch.current.values()],
        distance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
      if (before && distance) {
        const oldX = (old[0].x + old[1].x) / 2,
          oldY = (old[0].y + old[1].y) / 2;
        const newX = (after[0].x + after[1].x) / 2,
          newY = (after[0].y + after[1].y) / 2;
        p.setView((view) => {
          const anchor = unproject(oldX, oldY, view, cx, cy, r, false, aspect);
          const zoomed = zoomAt(
            view,
            ((view.mode === "allsky" ? 150 : view.fov) * before) / distance,
            oldX, oldY, cx, cy, r, aspect,
          );
          return anchor
            ? anchorDirection(zoomed, anchor, newX, newY, cx, cy, r, aspect)
            : zoomed;
        });
      }
      if (drag.current) drag.current.moved = true;
      setDragging(true);
      return;
    }
    if (drag.current) {
      const d = drag.current,
        dx = pos.x - d.x,
        dy = pos.y - d.y;
      if (Math.hypot(dx, dy) > 4 && !d.moved) {
        d.moved = true;
        setDragging(true);
      }
      if (d.moved && !p.aiming && !d.field) {
        const anchor = unproject(d.x, d.y, d.view, cx, cy, r, false, aspect);
        p.setView(
          anchor
            ? anchorDirection(d.view, anchor, pos.x, pos.y, cx, cy, r, aspect)
            : {
                ...p.view,
                mode: "horizon",
                az: wrap(d.az - (dx * p.view.fov) / (2 * r)),
                alt: clamp(d.alt + (dy * p.view.fov) / (2 * r), -30, 89),
              },
        );
        setHover(null);
      }
      return;
    }
    const nearest = hitObject(pos, e.pointerType === "touch" ? 24 : 16);
    setHover(nearest ? { object: nearest.o, x: pos.x, y: pos.y } : null);
  };
  const pointerUp = (e: React.PointerEvent) => {
    const pos = position(e),
      d = drag.current;
    pinch.current.delete(e.pointerId);
    setDragging(false);
    if (!d) return;
    if (p.aiming || (d.field && d.moved)) {
      const h = unproject(pos.x, pos.y, p.view, cx, cy, r, false, aspect);
      if (h) p.aim(h.az, h.alt);
    } else if (!d.moved) {
      const object =
        (d.objectId ? p.sky.byId.get(d.objectId) : null) ??
        hitObject(pos, e.pointerType === "touch" ? 24 : 16)?.o;
      if (object) p.select(object);
    }
    drag.current = null;
  };
  return (
    <div
      className={`sky-canvas ${p.aiming ? "aiming" : ""} ${hover ? "over-object" : ""} ${isDragging ? "dragging" : ""}`}
      ref={host}
      onPointerDown={pointerDown}
      onDragStart={(e) => e.preventDefault()}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => {
        drag.current = null;
        pinch.current.clear();
        setDragging(false);
      }}
      onPointerLeave={() => setHover(null)}
      aria-label="Interactive sky map. Drag to look around, scroll or pinch to zoom. Select objects using the search or visible-object list."
      role="img"
    >
      <canvas ref={canvas} />
      <canvas ref={overlay} className="map-overlay" />
      {hover && !drag.current && (
        <div
          role="tooltip"
          className="sky-tooltip"
          style={{
            left: clamp(hover.x + 18, 8, size.w - 230),
            top: clamp(hover.y - 76, 8, size.h - 95),
          }}
        >
          <span className="eyebrow">{hover.object.subtitle}</span>
          <strong>{hover.object.name}</strong>
          <span>
            {distanceLabel(hover.object)} <i>/</i> {hover.object.alt.toFixed(1)}
            ° above horizon
          </span>
          {terrain && hover.object.alt < horizonAltitude(terrain, hover.object.az) && (
            <span>BEHIND MOUNTAIN SKYLINE</span>
          )}
          <small>CLICK TO EXPLORE ↗</small>
        </div>
      )}
    </div>
  );
}

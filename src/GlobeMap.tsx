import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { gstime } from "satellite.js";
import {
  earthFixedOrbit,
  EARTH_RADIUS_KM,
  globeFrame,
  globeGraticule,
  heightAbove,
  INACTIVE_CLASSES,
  inertialOrbit,
  ORBIT_CLASSES,
  orbitClass,
  orbitLabels,
  projectGlobe,
  traceSpace,
  traceSurface,
  unitVector,
  type GlobeCamera,
  type OrbitClass,
} from "./globe";
import { fetchDeepSpace } from "./api";
import { AU_KM, craftPosition, earthFixedAt, moonOrbit, moonPosition, NEAR_SPACE_KM, sunPosition } from "./deep-space";
import { globeCoastlines } from "./globe-coastlines";
import { clamp } from "./projection";
import { isDocumentedMission } from "./satellite-info";
import { deepSpaceSymbol, globePalette, satelliteSymbols, skyPalette, type SatelliteShape, type Theme } from "./theme";
import type { DeepSpaceData, Layers, Satellite, Sky, SkyObject } from "./types";
import { useGlobePointer, type CraftHit, type GlobeHits } from "./useGlobePointer";

interface Props {
  theme: Theme;
  fontFamily: string;
  fontRevision: number;
  sky: Sky;
  camera: GlobeCamera;
  setCamera: Dispatch<SetStateAction<GlobeCamera>>;
  layers: Layers;
  /** Draw orbits for the selected satellite and the labelled stations. */
  orbits: boolean;
  showHighlights: boolean;
  selected: SkyObject | null;
  select: (o: SkyObject) => void;
}
type Orbit = { satellite: Satellite; time: number; path: Float64Array | null };

/** Add one satellite symbol to the current path, centred on (x, y). */
function addSymbol(c: CanvasRenderingContext2D, shape: SatelliteShape, x: number, y: number, s: number) {
  const h = s / 2;
  if (shape === "dot" || shape === "ring") {
    c.moveTo(x + h, y);
    c.arc(x, y, h, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    c.moveTo(x, y - h);
    c.lineTo(x + h, y);
    c.lineTo(x, y + h);
    c.lineTo(x - h, y);
    c.closePath();
  } else if (shape === "cross") {
    c.moveTo(x - h, y - h);
    c.lineTo(x + h, y + h);
    c.moveTo(x + h, y - h);
    c.lineTo(x - h, y + h);
  } else if (shape === "plus") {
    c.moveTo(x - h, y);
    c.lineTo(x + h, y);
    c.moveTo(x, y - h);
    c.lineTo(x, y + h);
  } else if (shape === "target") {
    c.moveTo(x + h, y);
    c.arc(x, y, h, 0, Math.PI * 2);
    c.moveTo(x + 1.3, y);
    c.arc(x, y, 1.3, 0, Math.PI * 2);
  } else if (shape === "triangle") {
    c.moveTo(x, y - h);
    c.lineTo(x + h, y + h * 0.75);
    c.lineTo(x - h, y + h * 0.75);
    c.closePath();
  } else c.rect(x - h, y - h, s, s);
}

/** Shapes drawn as outlines rather than fills. */
const STROKED: ReadonlySet<SatelliteShape> = new Set(["ring", "cross", "plus", "box", "target"]);

/** Distance from Earth, in kilometres near the planet and astronomical units far from it. */
const distanceLabel = (km: number) =>
  km < 1e7 ? `${(km / 1e6).toFixed(2)} MILLION KM` : `${(km / AU_KM).toFixed(km < 10 * AU_KM ? 2 : 1)} AU`;

/** Horizons positions, fetched once per page and shared by every globe mounted after. */
let deepSpaceCache: DeepSpaceData | null = null;
const DEEP_SPACE_REFRESH_MS = 6 * 3600000;
function useDeepSpace(enabled: boolean) {
  const [data, setData] = useState(deepSpaceCache);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = () =>
      fetchDeepSpace(controller.signal)
        .then((value) => {
          deepSpaceCache = value;
          setData(value);
          setError("");
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : "Deep-space positions unavailable.");
        });
    if (!deepSpaceCache || Date.now() - Date.parse(deepSpaceCache.fetchedAt) > DEEP_SPACE_REFRESH_MS) void load();
    const timer = setInterval(load, DEEP_SPACE_REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled]);
  return { data, error };
}

/** The station symbol's square brackets, as on the sky chart. */
function addBrackets(c: CanvasRenderingContext2D, x: number, y: number, n: number) {
  c.moveTo(x - n / 2, y - n);
  c.lineTo(x - n, y - n);
  c.lineTo(x - n, y + n);
  c.lineTo(x - n / 2, y + n);
  c.moveTo(x + n / 2, y - n);
  c.lineTo(x + n, y - n);
  c.lineTo(x + n, y + n);
  c.lineTo(x + n / 2, y + n);
}

/** A legend swatch drawn with the same geometry as the canvas symbol. */
export function SymbolSwatch({ shape, color }: { shape: SatelliteShape; color: string }) {
  const fill = STROKED.has(shape) ? "none" : color;
  return (
    <svg viewBox="-6 -6 12 12" aria-hidden="true">
      {shape === "dot" && <circle r="1.6" fill={fill} />}
      {shape === "ring" && <circle r="2.6" fill="none" stroke={color} strokeWidth="1" />}
      {shape === "square" && <rect x="-1.6" y="-1.6" width="3.2" height="3.2" fill={fill} />}
      {shape === "diamond" && <path d="M0 -3L3 0L0 3L-3 0Z" fill={fill} />}
      {shape === "triangle" && <path d="M0 -3L3 2.25L-3 2.25Z" fill={fill} />}
      {shape === "cross" && <path d="M-2.6 -2.6L2.6 2.6M2.6 -2.6L-2.6 2.6" stroke={color} strokeWidth="1.1" />}
      {shape === "plus" && <path d="M-3 0H3M0 -3V3" stroke={color} strokeWidth="1.1" />}
      {shape === "box" && <rect x="-2.2" y="-2.2" width="4.4" height="4.4" fill="none" stroke={color} strokeWidth="1" />}
      {shape === "target" && (
        <>
          <circle r="3.6" fill="none" stroke={color} strokeWidth="1" />
          <circle r="1.1" fill={color} />
        </>
      )}
      {shape === "station" && (
        <>
          <rect x="-1.4" y="-1.4" width="2.8" height="2.8" fill={fill} />
          <path d="M-2.5 -4.5H-4.5V4.5H-2.5M2.5 -4.5H4.5V4.5H2.5" fill="none" stroke={color} strokeWidth="1" />
        </>
      )}
    </svg>
  );
}

/** Satellites around a wireframe Earth, seen from space with north up. */
export default function GlobeMap(p: Props) {
  const colors = skyPalette[p.theme],
    inks = globePalette[p.theme];
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 700 });
  const [hidden, setHidden] = useState<ReadonlySet<OrbitClass>>(new Set());
  // Spacecraft beyond Earth orbit are on by default; zooming out brings them into view.
  const [deepSpace, setDeepSpace] = useState(true);
  const deep = useDeepSpace(deepSpace);
  const hits = useRef<GlobeHits | null>(null);
  const orbitCache = useRef(new Map<string, Orbit>());
  const moonCache = useRef<{ hour: number; path: [number, number, number][] } | null>(null);
  const frame = globeFrame(p.camera, size.w, size.h);
  const satellites = useMemo(
    () => p.sky.objects.filter((o) => o.kind === "satellite" && o.ecf && o.satellite),
    [p.sky],
  );
  const counts = useMemo(() => {
    const result = Object.fromEntries(ORBIT_CLASSES.map((k) => [k, 0])) as Record<OrbitClass, number>;
    for (const o of satellites) result[orbitClass(o.satellite!)]++;
    return result;
  }, [satellites]);
  const { hover, isDragging, drag, pointerDown, pointerMove, pointerUp, pointerCancel, pointerLeave } =
    useGlobePointer(
      { camera: p.camera, setCamera: p.setCamera, radius: frame.radius, height: size.h, select: p.select },
      host,
      hits,
    );
  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(host.current);
    return () => ro.disconnect();
  }, []);

  /** One revolution, reused while the inertial orbit is effectively unchanged. */
  const orbitOf = (satellite: Satellite, time: number) => {
    const cached = orbitCache.current.get(satellite.id);
    const period = (1440 / satellite.elements.MEAN_MOTION) * 60000;
    if (cached?.satellite === satellite && Math.abs(cached.time - time) < Math.min(600000, period / 8))
      return cached.path;
    const path = inertialOrbit(satellite, time);
    orbitCache.current.set(satellite.id, { satellite, time, path });
    if (orbitCache.current.size > 16) orbitCache.current.delete(orbitCache.current.keys().next().value!);
    return path;
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== Math.round(size.w * dpr)) el.width = Math.round(size.w * dpr);
    if (el.height !== Math.round(size.h * dpr)) el.height = Math.round(size.h * dpr);
    const c = el.getContext("2d");
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, size.w, size.h);
    c.font = `12px ${p.fontFamily}`;
    c.textBaseline = "middle";
    const f = frame,
      time = p.sky.time,
      gmst = gstime(time),
      grid = globeGraticule();

    // The far side shows through the wireframe, quietly, to keep the sphere legible.
    if (p.layers.grid) {
      c.beginPath();
      for (const line of [...grid.parallels, ...grid.meridians, grid.equator]) traceSurface(c, line, f, -1);
      c.strokeStyle = colors.grid;
      c.lineWidth = 0.6;
      c.setLineDash([1, 3]);
      c.stroke();
      c.setLineDash([]);
    }
    const selectedSatellite = p.selected?.satellite && p.selected.ecf ? p.selected : null;
    const orbiting = p.orbits
      ? satellites.filter(
          (o) =>
            o.id === selectedSatellite?.id ||
            (p.showHighlights && orbitClass(o.satellite!) === "station" && isDocumentedMission(o.satellite!) &&
              !hidden.has("station")),
        )
      : [];
    const paths = orbiting.flatMap((o) => {
      const path = orbitOf(o.satellite!, time.getTime());
      return path ? [{ o, path: earthFixedOrbit(path, gmst) }] : [];
    });
    const strokeOrbits = (side: 1 | -1) => {
      for (const { o, path } of paths) {
        c.beginPath();
        traceSpace(c, path, f, side);
        const selected = o.id === selectedSatellite?.id;
        c.strokeStyle = selected ? colors.ink : inks[orbitClass(o.satellite!)];
        c.globalAlpha = side === 1 ? (selected ? 0.9 : 0.6) : 0.3;
        c.lineWidth = selected ? 1 : 0.8;
        c.setLineDash(side === 1 ? [] : [2, 4]);
        c.stroke();
      }
      c.globalAlpha = 1;
      c.setLineDash([]);
    };
    strokeOrbits(-1);

    c.beginPath();
    c.arc(f.cx, f.cy, f.radius, 0, Math.PI * 2);
    c.strokeStyle = colors.rim;
    c.lineWidth = 1;
    c.stroke();
    if (p.layers.grid) {
      c.beginPath();
      for (const line of [...grid.parallels, ...grid.meridians]) traceSurface(c, line, f, 1);
      c.strokeStyle = colors.grid;
      c.lineWidth = 0.7;
      c.stroke();
      c.beginPath();
      traceSurface(c, grid.equator, f, 1);
      c.strokeStyle = colors.constellation;
      c.lineWidth = 0.9;
      c.stroke();
    }
    c.beginPath();
    for (const ring of globeCoastlines()) traceSurface(c, ring, f, 1);
    c.strokeStyle = inks.coast;
    c.lineWidth = 0.8;
    c.stroke();
    strokeOrbits(1);

    // Project every satellite once, then paint each class and lighting in one batch.
    const n = satellites.length,
      xs = new Float32Array(n).fill(NaN),
      ys = new Float32Array(n).fill(NaN);
    const groups = new Map<string, number[]>();
    if (p.layers.satellite)
      for (let i = 0; i < n; i++) {
        const o = satellites[i],
          kind = orbitClass(o.satellite!);
        if (hidden.has(kind)) continue;
        const e = o.ecf!,
          q = projectGlobe(f, e.x / EARTH_RADIUS_KM, e.y / EARTH_RADIUS_KM, e.z / EARTH_RADIUS_KM);
        if (q.hidden || q.x < -8 || q.y < -8 || q.x > size.w + 8 || q.y > size.h + 8) continue;
        xs[i] = q.x;
        ys[i] = q.y;
        const key = `${kind}:${o.sunlit ? 1 : 0}`;
        const group = groups.get(key) ?? [];
        group.push(i);
        groups.set(key, group);
      }
    const scale = clamp(0.9 + p.camera.zoom * 0.3, 1, 1.8);
    /** Paint the current path: first a knockout in the page colour, then the symbol over it. */
    const paint = (color: string, stroked: boolean) => {
      c.strokeStyle = inks.halo;
      c.lineWidth = stroked ? 3.2 : 1.6;
      c.stroke();
      if (stroked) {
        c.strokeStyle = color;
        c.lineWidth = 1.3;
        c.stroke();
      } else {
        c.fillStyle = color;
        c.fill();
      }
    };
    for (const kind of [...ORBIT_CLASSES].reverse())
      for (const lit of [0, 1]) {
        const group = groups.get(`${kind}:${lit}`);
        if (!group) continue;
        const symbol = satelliteSymbols[kind],
          s = symbol.size * scale;
        // Satellites in Earth's shadow keep their colour and shape but fade a little, as on the chart.
        c.globalAlpha = lit ? 1 : 0.6;
        c.beginPath();
        for (const i of group) addSymbol(c, symbol.shape, xs[i], ys[i], s);
        paint(inks[kind], STROKED.has(symbol.shape));
        if (symbol.shape === "station") {
          c.beginPath();
          for (const i of group) addBrackets(c, xs[i], ys[i], 3 + s);
          paint(inks[kind], true);
        }
      }
    c.globalAlpha = 1;

    // Far out the planet shrinks below its own outline; a dot keeps it findable among the satellites.
    if (f.radius < 3) {
      c.beginPath();
      c.arc(f.cx, f.cy, 2.5, 0, Math.PI * 2);
      c.fillStyle = colors.rim;
      c.fill();
    }

    // Beyond Earth orbit: the Moon for scale, craft at the Lagrange points to scale, and
    // farther craft and the Sun as direction markers at the chart's edge.
    const fieldKm = (2 * EARTH_RADIUS_KM) / p.camera.zoom;
    const craftHits: CraftHit[] = [];
    const deepLabels: { label: string; x: number; y: number }[] = [];
    const edges: { label: string; x: number; y: number; dx: number; dy: number; craft?: CraftHit }[] = [];
    const toScreen = ([x, y, z]: [number, number, number]) =>
      projectGlobe(f, x / EARTH_RADIUS_KM, y / EARTH_RADIUS_KM, z / EARTH_RADIUS_KM);
    const onCanvas = (q: { x: number; y: number }) => q.x >= 0 && q.y >= 0 && q.x <= size.w && q.y <= size.h;
    /** Where a direction leaves the chart, inset clear of the controls along its edges. */
    const edgePoint = ([x, y, z]: [number, number, number]) => {
      const dx = x * f.right[0] + y * f.right[1] + z * f.right[2],
        dy = -(x * f.up[0] + y * f.up[1] + z * f.up[2]),
        length = Math.hypot(dx, dy) || 1;
      const ux = dx / length,
        uy = dy / length;
      const reach = Math.min(
        ux > 0 ? (size.w - 48 - f.cx) / ux : ux < 0 ? (16 - f.cx) / ux : Infinity,
        uy > 0 ? (size.h - 40 - f.cy) / uy : uy < 0 ? (64 - f.cy) / uy : Infinity,
      );
      return { x: f.cx + ux * reach, y: f.cy + uy * reach, dx: ux, dy: uy };
    };
    if (deepSpace && deep.data) {
      const toFixed = earthFixedAt(time);
      if (fieldKm > 150000) {
        const hour = Math.floor(time.getTime() / 3600000);
        if (moonCache.current?.hour !== hour) moonCache.current = { hour, path: moonOrbit(time.getTime()) };
        const orbit = new Float64Array(moonCache.current.path.flatMap((v) => toFixed(v).map((n) => n / EARTH_RADIUS_KM)));
        c.beginPath();
        traceSpace(c, orbit, f, 1);
        c.strokeStyle = colors.constellation;
        c.lineWidth = 0.8;
        c.setLineDash([3, 4]);
        c.stroke();
        c.setLineDash([]);
        const moon = toScreen(toFixed(moonPosition(time)));
        if (!moon.hidden && onCanvas(moon)) {
          c.beginPath();
          c.arc(moon.x, moon.y, Math.max(3, (1737.4 / EARTH_RADIUS_KM) * f.radius), 0, Math.PI * 2);
          c.fillStyle = colors.moon;
          c.fill();
          deepLabels.push({ label: "MOON", x: moon.x, y: moon.y });
        }
      }
      if (fieldKm > 400000) {
        const sun = edgePoint(toFixed(sunPosition(time)));
        edges.push({ label: "☼ SUN", ...sun });
      }
      const s = deepSpaceSymbol.size;
      c.beginPath();
      deep.data.craft.forEach((craft, index) => {
        const position = craftPosition(deep.data!, index, time.getTime());
        if (!position) return;
        const distance = Math.hypot(...position),
          fixed = toFixed(position);
        if (distance < NEAR_SPACE_KM) {
          const q = toScreen(fixed);
          if (q.hidden || !onCanvas(q)) return;
          addSymbol(c, deepSpaceSymbol.shape, q.x, q.y, s);
          craftHits.push({ name: craft.name, region: craft.region, distance, x: q.x, y: q.y });
          deepLabels.push({ label: craft.name, x: q.x, y: q.y });
        } else if (fieldKm > 400000) {
          const edge = edgePoint(fixed);
          const hit = { name: craft.name, region: craft.region, distance, x: edge.x, y: edge.y };
          edges.push({ label: `${craft.name} · ${distanceLabel(distance)}`, ...edge, craft: hit });
        }
      });
      c.strokeStyle = inks.halo;
      c.lineWidth = 3.2;
      c.stroke();
      c.strokeStyle = inks.deep;
      c.lineWidth = 1.3;
      c.stroke();
    }
    hits.current = { objects: satellites, xs, ys, craft: craftHits };

    // The observer, and a line of sight to the selected satellite when it is above their horizon.
    const site = unitVector(p.sky.site.lat, p.sky.site.lon),
      here = projectGlobe(f, ...site);
    const selectedIndex = selectedSatellite ? satellites.findIndex((o) => o.id === selectedSatellite.id) : -1;
    if (here.depth >= 0) {
      if (selectedIndex >= 0 && selectedSatellite!.alt >= 0 && Number.isFinite(xs[selectedIndex])) {
        c.beginPath();
        c.moveTo(here.x, here.y);
        c.lineTo(xs[selectedIndex], ys[selectedIndex]);
        c.strokeStyle = colors.ink;
        c.lineWidth = 0.8;
        c.setLineDash([2, 3]);
        c.stroke();
        c.setLineDash([]);
      }
      c.beginPath();
      c.arc(here.x, here.y, 4.5, 0, Math.PI * 2);
      c.moveTo(here.x - 8, here.y);
      c.lineTo(here.x + 8, here.y);
      c.moveTo(here.x, here.y - 8);
      c.lineTo(here.x, here.y + 8);
      c.strokeStyle = colors.ink;
      c.lineWidth = 1;
      c.stroke();
    }

    // Edge markers first, so in-chart labels give way to them: an arrow pointing out, its label inside.
    // Both keep clear of the controls laid over the chart; a marker with no room is left out.
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const origin = host.current?.getBoundingClientRect();
    const overlays = host.current
      ?.closest(".sky-stage")
      ?.querySelectorAll(".stage-top, .search-box, .map-readout, .zoom-controls, .map-caption, .globe-legend");
    const obstacles: typeof boxes = [];
    for (const node of overlays ?? []) {
      const r = node.getBoundingClientRect();
      if (origin && r.width && r.height)
        obstacles.push({ x: r.left - origin.left - 4, y: r.top - origin.top - 4, w: r.width + 8, h: r.height + 8 });
    }
    const overlaps = (x: number, y: number, w: number, h: number, list: typeof boxes) =>
      list.some((b) => x < b.x + b.w && x + w > b.x && y < b.y + b.h && y + h > b.y);
    c.font = `11px ${p.fontFamily}`;
    for (const edge of edges) {
      if (overlaps(edge.x - 6, edge.y - 6, 12, 12, obstacles)) continue;
      const width = c.measureText(edge.label).width + 8;
      const baseX = clamp(edge.x - edge.dx * 14 - (edge.dx > 0.3 ? width : edge.dx < -0.3 ? 0 : width / 2), 4, size.w - width - 4),
        baseY = clamp(edge.y - edge.dy * 16, 12, size.h - 12);
      // Craft in similar directions stack their labels: along a side edge, or inward from the top and bottom.
      const shifts = Math.abs(edge.dx) > Math.abs(edge.dy)
        ? [0, 18, -18, 36, -36, 54, -54]
        : [0, 18, 36, 54, 72].map((d) => -Math.sign(edge.dy || 1) * d);
      const shift = shifts.find((d) => !overlaps(baseX - 3, baseY + d - 8, width, 16, [...obstacles, ...boxes]));
      if (shift === undefined) continue;
      const x = baseX,
        y = baseY + shift;
      if (edge.craft) craftHits.push(edge.craft);
      if (shift) {
        c.beginPath();
        c.moveTo(edge.x, edge.y);
        c.lineTo(clamp(edge.x, x, x + width - 8), y);
        c.strokeStyle = colors.constellation;
        c.lineWidth = 0.6;
        c.stroke();
      }
      c.beginPath();
      c.moveTo(edge.x + edge.dx * 5, edge.y + edge.dy * 5);
      c.lineTo(edge.x - edge.dx * 3 - edge.dy * 4, edge.y - edge.dy * 3 + edge.dx * 4);
      c.lineTo(edge.x - edge.dx * 3 + edge.dy * 4, edge.y - edge.dy * 3 - edge.dx * 4);
      c.closePath();
      c.fillStyle = edge.craft ? inks.deep : colors.sun;
      c.fill();
      boxes.push({ x: x - 3, y: y - 8, w: width, h: 16 });
      c.fillStyle = colors.label;
      c.fillRect(x - 3, y - 8, width, 16);
      c.fillStyle = colors.muted;
      c.fillText(edge.label, x, y);
    }
    c.font = `12px ${p.fontFamily}`;

    // Labels: the selected satellite first, then the observer, deep-space craft and documented missions where they fit.
    const candidates: { label: string; x: number; y: number; selected: boolean; site?: boolean }[] = [];
    if (selectedIndex >= 0 && Number.isFinite(xs[selectedIndex]))
      candidates.push({ label: selectedSatellite!.name, x: xs[selectedIndex], y: ys[selectedIndex], selected: true });
    // Out at the Lagrange points the observer is a pixel inside the planet; a label there would only cover it.
    if (here.depth >= 0 && f.radius >= 40)
      candidates.push({ label: p.sky.site.name.toUpperCase(), x: here.x, y: here.y, selected: false, site: true });
    for (const label of deepLabels) candidates.push({ ...label, selected: false });
    // A small, distant globe has no room for standing labels; they would hide the planet.
    if (p.showHighlights && f.radius >= 140)
      satellites.forEach((o, i) => {
        if (i !== selectedIndex && Number.isFinite(xs[i]) && isDocumentedMission(o.satellite!))
          candidates.push({ label: o.name, x: xs[i], y: ys[i], selected: false });
      });
    for (const q of candidates) {
      const label = q.label.length > 25 ? q.label.slice(0, 24) + "…" : q.label;
      const width = c.measureText(label).width + 8,
        offset = q.selected ? 13 : 9;
      const placement = [
        { x: q.x + offset, y: q.y - 11 },
        { x: q.x - width - offset, y: q.y - 11 },
        { x: q.x + offset, y: q.y + 13 },
        { x: q.x - width - offset, y: q.y + 13 },
      ].find(
        ({ x, y }) =>
          x - 3 >= 0 && x + width <= size.w && y - 8 >= 0 && y + 8 <= size.h &&
          !boxes.some((b) => x < b.x + b.w && x + width > b.x && y - 8 < b.y + b.h && y + 8 > b.y),
      );
      if (!placement) continue;
      boxes.push({ x: placement.x, y: placement.y - 8, w: width, h: 16 });
      c.fillStyle = colors.label;
      c.fillRect(placement.x - 3, placement.y - 8, width, 16);
      c.fillStyle = q.selected ? colors.ink : colors.muted;
      c.fillText(label, placement.x, placement.y);
      if (q.selected) {
        c.strokeStyle = colors.ink;
        c.lineWidth = 1;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          c.beginPath();
          c.moveTo(q.x + sx * offset, q.y + sy * (offset - 5));
          c.lineTo(q.x + sx * offset, q.y + sy * offset);
          c.lineTo(q.x + sx * (offset - 5), q.y + sy * offset);
          c.stroke();
        }
      }
    }
  }, [
    p.sky,
    p.camera,
    p.layers,
    p.orbits,
    p.showHighlights,
    p.selected?.id,
    p.theme,
    p.fontFamily,
    p.fontRevision,
    satellites,
    hidden,
    size,
    deepSpace,
    deep.data,
  ]);

  const hovered = hover?.object,
    hoveredCraft = hover?.craft;
  const deepCount = deep.data
    ? deep.data.craft.filter((_, i) => craftPosition(deep.data!, i, p.sky.time.getTime())).length
    : 0;
  const toggle = (kind: OrbitClass) =>
    setHidden((previous) => {
      const next = new Set(previous);
      if (!next.delete(kind)) next.add(kind);
      return next;
    });
  return (
    <>
      <div
        className={`sky-canvas globe-canvas ${hover ? "over-object" : ""} ${isDragging ? "dragging" : ""}`}
        ref={host}
        onPointerDown={pointerDown}
        onDragStart={(e) => e.preventDefault()}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerCancel}
        onPointerLeave={pointerLeave}
        aria-label="Globe of Earth with the tracked satellites around it. Drag to turn, scroll or pinch to zoom. Select a satellite to explore it."
        role="img"
      >
        <canvas ref={canvas} />
        {hovered && !drag.current && (
          <div
            role="tooltip"
            className="sky-tooltip"
            style={{ left: clamp(hover.x + 18, 8, size.w - 230), top: clamp(hover.y - 76, 8, size.h - 95) }}
          >
            <span className="eyebrow">
              {orbitLabels[orbitClass(hovered.satellite!)].toUpperCase()} · NORAD {hovered.satellite!.elements.NORAD_CAT_ID}
            </span>
            <strong>{hovered.name}</strong>
            <span>
              {Math.round(heightAbove(hovered.ecf!)).toLocaleString("en-GB")} KM UP <i>/</i>{" "}
              {hovered.sunlit ? "SUNLIT" : "IN EARTH’S SHADOW"}
            </span>
            <span>
              {hovered.alt >= 0 ? `↑ ${hovered.alt.toFixed(0)}° ABOVE YOUR HORIZON` : "↓ BELOW YOUR HORIZON"}
            </span>
            <small>CLICK TO EXPLORE ↗</small>
          </div>
        )}
        {hoveredCraft && !drag.current && (
          <div
            role="tooltip"
            className="sky-tooltip"
            style={{ left: clamp(hover.x + 18, 8, size.w - 230), top: clamp(hover.y - 76, 8, size.h - 95) }}
          >
            <span className="eyebrow">
              DEEP SPACE{hoveredCraft.region ? ` · SUN–EARTH ${hoveredCraft.region}` : ""}
            </span>
            <strong>{hoveredCraft.name}</strong>
            <span>{distanceLabel(hoveredCraft.distance)} FROM EARTH</span>
            <small>POSITION FROM JPL HORIZONS</small>
          </div>
        )}
      </div>
      <div className="globe-legend" role="group" aria-label="Satellite classes">
        {p.layers.satellite &&
          ORBIT_CLASSES.filter((kind) => !INACTIVE_CLASSES.has(kind) || counts[kind] > 0).map((kind) => (
            <button
              key={kind}
              aria-pressed={!hidden.has(kind)}
              title={`${hidden.has(kind) ? "Show" : "Hide"} ${orbitLabels[kind].toLowerCase()}`}
              onClick={() => toggle(kind)}
            >
              <SymbolSwatch shape={satelliteSymbols[kind].shape} color={inks[kind]} />
              <span>{orbitLabels[kind]}</span>
              <span className="count">{counts[kind].toLocaleString("en-GB")}</span>
            </button>
          ))}
        <button
          aria-pressed={deepSpace}
          title={
            deep.error ||
            "Spacecraft beyond Earth orbit. Zoom out past the Moon to see those at the Sun–Earth Lagrange points; farther craft point from the chart's edge."
          }
          onClick={() => setDeepSpace((value) => !value)}
        >
          <SymbolSwatch shape={deepSpaceSymbol.shape} color={inks.deep} />
          <span>Deep space</span>
          <span className="count">{deep.error && !deep.data ? "—" : deepCount}</span>
        </button>
      </div>
    </>
  );
}

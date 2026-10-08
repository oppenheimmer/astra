import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { gstime } from "satellite.js";
import {
  earthFixedOrbit,
  EARTH_RADIUS_KM,
  globeFrame,
  globeGraticule,
  heightAbove,
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
import { globeCoastlines } from "./globe-coastlines";
import { clamp } from "./projection";
import { isDocumentedMission } from "./satellite-info";
import { globePalette, satelliteSymbols, skyPalette, type SatelliteShape, type Theme } from "./theme";
import type { Layers, Satellite, Sky, SkyObject } from "./types";
import { useGlobePointer, type GlobeHits } from "./useGlobePointer";

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
  } else if (shape === "triangle") {
    c.moveTo(x, y - h);
    c.lineTo(x + h, y + h * 0.75);
    c.lineTo(x - h, y + h * 0.75);
    c.closePath();
  } else c.rect(x - h, y - h, s, s);
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
export function SymbolSwatch({ kind, color }: { kind: OrbitClass; color: string }) {
  const { shape } = satelliteSymbols[kind];
  const fill = shape === "ring" || shape === "cross" ? "none" : color;
  return (
    <svg viewBox="-6 -6 12 12" aria-hidden="true">
      {shape === "dot" && <circle r="1.6" fill={fill} />}
      {shape === "ring" && <circle r="2.6" fill="none" stroke={color} strokeWidth="1" />}
      {shape === "square" && <rect x="-1.6" y="-1.6" width="3.2" height="3.2" fill={fill} />}
      {shape === "diamond" && <path d="M0 -3L3 0L0 3L-3 0Z" fill={fill} />}
      {shape === "triangle" && <path d="M0 -3L3 2.25L-3 2.25Z" fill={fill} />}
      {shape === "cross" && <path d="M-2.6 -2.6L2.6 2.6M2.6 -2.6L-2.6 2.6" stroke={color} strokeWidth="1.1" />}
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
  const hits = useRef<GlobeHits | null>(null);
  const orbitCache = useRef(new Map<string, Orbit>());
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
    hits.current = { objects: satellites, xs, ys };
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
        paint(inks[kind], symbol.shape === "ring" || symbol.shape === "cross");
        if (symbol.shape === "station") {
          c.beginPath();
          for (const i of group) addBrackets(c, xs[i], ys[i], 3 + s);
          paint(inks[kind], true);
        }
      }
    c.globalAlpha = 1;

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

    // Labels: the selected satellite first, then documented missions where they fit.
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    const candidates: { label: string; x: number; y: number; selected: boolean; site?: boolean }[] = [];
    if (selectedIndex >= 0 && Number.isFinite(xs[selectedIndex]))
      candidates.push({ label: selectedSatellite!.name, x: xs[selectedIndex], y: ys[selectedIndex], selected: true });
    if (here.depth >= 0)
      candidates.push({ label: p.sky.site.name.toUpperCase(), x: here.x, y: here.y, selected: false, site: true });
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
  ]);

  const hovered = hover?.object;
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
      </div>
      {p.layers.satellite && (
        <div className="globe-legend" role="group" aria-label="Satellite classes">
          {ORBIT_CLASSES.map((kind) => (
            <button
              key={kind}
              aria-pressed={!hidden.has(kind)}
              title={`${hidden.has(kind) ? "Show" : "Hide"} ${orbitLabels[kind].toLowerCase()}`}
              onClick={() => toggle(kind)}
            >
              <SymbolSwatch kind={kind} color={inks[kind]} />
              <span>{orbitLabels[kind]}</span>
              <span className="count">{counts[kind].toLocaleString("en-GB")}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

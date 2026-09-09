import { useEffect, useId, useMemo, useState } from "react";
import { earthLand } from "./earth-land";
import type { SkyObject, Star, Site } from "./types";
import {
  nearbyStars,
  solarOrbits,
  solarPositions,
  satellitePosition,
} from "./sky";
import { RAD } from "./projection";
import GalaxyDrawing from "./GalaxyDrawing";

const galaxyPoint = (s: { x: number; y: number; z: number }) => ({
  x: -0.05487556 * s.x - 0.87343709 * s.y - 0.48383502 * s.z,
  y: 0.49410943 * s.x - 0.44482963 * s.y + 0.74698224 * s.z,
});
const CircleGrid = () => (
  <g className="diagram-grid">
    <path d="M20 100H280M150 12V188" />
    <circle cx="150" cy="100" r="40" />
    <circle cx="150" cy="100" r="80" />
  </g>
);
export function SolarSystem({
  object,
  date,
}: {
  object: SkyObject;
  date: Date;
}) {
  const selected = object.body === "Moon" ? "Earth" : object.body;
  const isInner = (name: string | undefined) =>
    ["Mercury", "Venus", "Earth", "Mars"].includes(name || "");
  const [inner, setInner] = useState(isInner(selected));
  useEffect(() => setInner(isInner(selected)), [selected]);
  const planets = useMemo(() => solarPositions(date), [date]);
  const year = date.getUTCFullYear();
  const orbits = useMemo(() => solarOrbits(year), [year]);
  const clipId = useId();
  const range = inner ? 2 : 32,
    scale = 114 / range,
    cx = 150,
    cy = 132;
  const here = planets.find((p) => p.name === selected);
  const point = (p: { x: number; y: number }) => ({
    x: cx + p.x * scale,
    y: cy - p.y * scale,
  });
  const visible = planets.filter((p) => !inner || isInner(p.name));
  return (
    <div className="context-diagram solar-system">
      <div className="diagram-label">
        <span>THE SOLAR SYSTEM</span>
        <span>TRUE DISTANCE</span>
      </div>
      <div
        className="solar-controls"
        role="group"
        aria-label="Solar System scale"
      >
        <button
          className={!inner ? "active" : ""}
          onClick={() => setInner(false)}
        >
          ALL PLANETS
        </button>
        <button
          className={inner ? "active" : ""}
          onClick={() => setInner(true)}
        >
          INNER PLANETS
        </button>
      </div>
      <svg
        viewBox="0 0 300 290"
        aria-label="Solar System with linear astronomical-unit distances and calculated orbital paths"
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="14" y="12" width="272" height="244" />
          </clipPath>
        </defs>
        <g className="diagram-grid">
          <path d="M20 132H280M150 12V250" />
        </g>
        <g clipPath={`url(#${clipId})`}>
          {orbits
            .filter((o) => !inner || isInner(o.name))
            .map((o) => (
              <path
                key={o.name}
                data-planet={o.name}
                className={
                  o.name === selected ? "selected-orbit" : "orbit-line"
                }
                d={o.points
                  .map((p, i) => {
                    const q = point(p);
                    return `${i ? "L" : "M"}${q.x.toFixed(3)} ${q.y.toFixed(3)}`;
                  })
                  .join(" ")}
              />
            ))}
          {visible.map((p) => {
            const q = point(p),
              sel = p.name === selected;
            return (
              <g
                key={p.name}
                data-planet-position={p.name}
                data-distance-au={p.distance}
              >
                {sel && (
                  <circle className="focus-ring" cx={q.x} cy={q.y} r="6" />
                )}
                <circle
                  className={sel ? "diagram-dot selected" : "diagram-dot"}
                  cx={q.x}
                  cy={q.y}
                  r={sel ? 2.7 : inner ? 2 : 1.6}
                />
              </g>
            );
          })}
        </g>
        {visible
          .filter(
            (p) =>
              inner ||
              p.name === selected ||
              ["Jupiter", "Saturn", "Uranus", "Neptune"].includes(p.name),
          )
          .map((p) => {
            const q = point(p),
              right = q.x >= 150,
              x = Math.max(42, Math.min(258, q.x + (right ? 12 : -12))),
              y = Math.max(19, Math.min(248, q.y + (q.y > 132 ? 17 : -12)));
            return (
              <g key={p.name}>
                <path className="leader" d={`M${q.x} ${q.y}L${x} ${y - 3}`} />
                <text x={x} y={y} textAnchor={right ? "start" : "end"}>
                  {p.name.toUpperCase()}
                </text>
              </g>
            );
          })}
        <circle
          className="diagram-dot selected"
          cx={cx}
          cy={cy}
          r={inner ? 3 : 1.8}
        />
        <text x={cx - 5} y={cy + 12} textAnchor="end">
          SUN
        </text>
        <path
          className="galaxy-scale"
          d={`M23 266v4h${(inner ? 0.5 : 10) * scale}v-4`}
        />
        <text x="23" y="284">
          {inner ? "0.5 AU" : "10 AU"}
        </text>
        <text x="278" y="284" textAnchor="end">
          TOP VIEW / {inner ? "INNER" : "FULL"} SYSTEM
        </text>
      </svg>
      {here && (
        <div className="solar-distance">
          <span>{selected?.toUpperCase()} / FROM SUN</span>
          <strong>{here.distance.toFixed(2)} AU</strong>
        </div>
      )}
      <p className="diagram-note">
        Distances share one linear scale. Planet markers are enlarged.{" "}
        {inner ? "" : "Use Inner planets to inspect the close orbits."} 1 AU ≈
        Earth–Sun distance.
      </p>
      {inner && here && here.distance > 2 && (
        <p className="diagram-note">{selected} is outside this inner view.</p>
      )}
      {object.body === "Moon" && (
        <p className="diagram-note">
          The Moon shares Earth’s marker at this scale.
        </p>
      )}
    </div>
  );
}
export function StarNeighbourhood({
  object,
  stars,
}: {
  object: SkyObject;
  stars: Star[];
}) {
  const neighbours = useMemo(
    () => (object.star?.dist ? nearbyStars(object.star, stars) : []),
    [object.star, stars],
  );
  if (!object.star || !object.star.dist)
    return (
      <p className="diagram-note">
        No reliable catalogue distance for this star. A spatial neighbourhood
        cannot be placed.
      </p>
    );
  const center = galaxyPoint(object.star),
    pts = neighbours.slice(0, 5).map(({ star, distance }) => {
      const p = galaxyPoint(star);
      return { star, distance, dx: p.x - center.x, dy: p.y - center.y };
    });
  const scale = 83 / Math.max(0.5, ...pts.map((p) => Math.hypot(p.dx, p.dy)));
  return (
    <>
      <div className="context-diagram">
        <div className="diagram-label">
          <span>STELLAR NEIGHBOURHOOD</span>
          <span>LOCAL VIEW</span>
        </div>
        <svg
          viewBox="0 0 300 205"
          aria-label="Nearby catalogue stars projected onto the galactic plane"
        >
          <CircleGrid />
          {pts.map((p, i) => {
            const x = 150 + p.dx * scale,
              y = 100 - p.dy * scale,
              label = String(i + 1).padStart(2, "0");
            return (
              <g key={p.star.id}>
                <path className="connection-line" d={`M150 100L${x} ${y}`} />
                <circle className="diagram-dot" cx={x} cy={y} r="2.5" />
                <text
                  x={x + (x < 145 ? -6 : 6)}
                  y={y + (i % 2 === 0 ? -8 : 12)}
                  textAnchor={x < 145 ? "end" : "start"}
                >
                  {label}
                </text>
              </g>
            );
          })}
          <circle className="focus-ring" cx="150" cy="100" r="8" />
          <circle className="diagram-dot" cx="150" cy="100" r="3" />
          <rect
            x="119"
            y="112"
            width="62"
            height="14"
            className="diagram-label-bg"
          />
          <text x="150" y="123" textAnchor="middle">
            SELECTED
          </text>
        </svg>
        <p className="diagram-note">
          Nearest stars in this catalogue sample.
          <br />
          Galactic-plane projection; depth is flattened.
        </p>
      </div>
      <div className="neighbour-list">
        {neighbours.slice(0, 5).map((p, i) => (
          <div key={p.star.id}>
            <span>
              {String(i + 1).padStart(2, "0")} / {p.star.name}
            </span>
            <span>{p.distance.toFixed(1)} ly away</span>
          </div>
        ))}
      </div>
      <GalaxyLocator object={object} />
    </>
  );
}
export function GalaxyLocator({ object }: { object: SkyObject }) {
  const p = object.star ? galaxyPoint(object.star) : { x: 0, y: 0 };
  const scale = 96 / 15000,
    sunX = 150 + 8200 * scale;
  const dx = (8200 - p.x) * scale,
    dy = -p.y * scale;
  const extent = Math.hypot(dx, dy),
    fit = Math.min(1, 99 / Math.max(1, extent));
  const x = 150 + dx * fit,
    y = 118 + dy * fit * 0.8;
  const together = Math.hypot(x - sunX, y - 118) < 9;
  const label = together ? `SUN / ${object.name.toUpperCase()}` : "SUN";
  return (
    <div className="context-diagram galaxy-locator galaxy-atlas">
      <div className="diagram-label">
        <span>WITHIN THE MILKY WAY</span>
        <span>SCHEMATIC</span>
      </div>
      <svg
        viewBox="0 0 300 250"
        aria-label="Approximate position of the selected star relative to the Sun and Galactic Centre"
      >
        <g transform="translate(150 118) scale(1 .8) rotate(-18)">
          <GalaxyDrawing />
        </g>
        <path
          className="galaxy-guide"
          d="M150 19v10M150 207v10M43 118h10M247 118h10"
        />
        <circle className="galaxy-marker-core" cx="150" cy="118" r="2" />
        <path className="galaxy-annotation" d="M146 123L105 180H23" />
        <text className="galaxy-label" x="23" y="193">
          GALACTIC CENTRE
        </text>
        <circle className="galaxy-marker" cx={sunX} cy="118" r="4" />
        <circle className="galaxy-marker-core" cx={sunX} cy="118" r="1.3" />
        <circle className="focus-ring" cx={x} cy={y} r={together ? 8 : 5} />
        <path className="galaxy-annotation" d={`M${sunX + 8} 114L235 76H281`} />
        <text className="galaxy-label" x="281" y="69" textAnchor="end">
          {label.length > 27 ? label.slice(0, 26) + "…" : label}
        </text>
        {!together && (
          <g>
            <path
              className="galaxy-annotation"
              d={`M${x} ${y + 6}L${x} ${Math.min(218, y + 23)}`}
            />
            <text
              className="galaxy-label"
              x={Math.max(48, Math.min(251, x))}
              y={Math.min(230, y + 34)}
              textAnchor="middle"
            >
              {extent > 99 ? "BEYOND FRAME" : "SELECTED STAR"}
            </text>
          </g>
        )}
        <path
          className="galaxy-scale"
          d={`M23 225v4h${(10000 / 3.2615638) * scale}v-4`}
        />
        <text className="galaxy-label" x="23" y="241">
          10,000 LY
        </text>
        <text className="galaxy-label" x="281" y="241" textAnchor="end">
          OUR GALAXY / OBLIQUE VIEW
        </text>
      </svg>
      <p className="diagram-note">
        {together
          ? "The Sun and this star share a marker at this scale."
          : "Ring: selected star. Small dot: our Sun."}{" "}
        Spiral structure is illustrative.
      </p>
    </div>
  );
}
export function EarthOrbit({
  object,
  date,
  site,
}: {
  object: SkyObject;
  date: Date;
  site: Site;
}) {
  const sat = object.satellite!;
  const position = satellitePosition(sat, date, site);
  const minute = Math.floor(date.getTime() / 60000);
  const points = useMemo(() => {
    const result: { lat: number; lon: number; time: number }[] = [];
    for (let t = -2700; t <= 2760; t += 60) {
      const time = minute * 60000 + t * 1000;
      const p = satellitePosition(sat, new Date(time), site);
      if (p) result.push({ lat: p.lat, lon: p.lon, time });
    }
    return result;
  }, [sat, minute, site]);
  const project = (lon: number, lat: number) => ({
    x: 150 + (lon / 180) * 133,
    y: 94 - (lat / 90) * 70,
  });
  const makePath = (past: boolean) => {
    let prev: null | { x: number; y: number } = null,
      d = "";
    const now = date.getTime();
    const part = points.filter(
      (p) =>
        Math.abs(p.time - now) <= 2700000 &&
        (past ? p.time < now : p.time > now),
    );
    if (position) {
      const current = { lat: position.lat, lon: position.lon, time: now };
      if (past) part.push(current);
      else part.unshift(current);
    }
    for (const p of part) {
      const q = project(p.lon, p.lat);
      d += `${prev && Math.abs(prev.x - q.x) < 130 ? "L" : "M"}${q.x},${q.y}`;
      prev = q;
    }
    return d;
  };
  const here = project(site.lon, site.lat),
    current = position ? project(position.lon, position.lat) : null;
  return (
    <div className="context-diagram">
      <div className="diagram-label">
        <span>EARTH / GROUND TRACK</span>
        <span>±45 MIN</span>
      </div>
      <svg
        viewBox="0 0 300 197"
        aria-label="Satellite ground track over Earth's continents in longitude and latitude"
      >
        <g className="earth-land" fillRule="evenodd" aria-hidden="true">
          {earthLand.map((d, i) => <path key={i} d={d} />)}
        </g>
        <rect className="orbit-line" x="17" y="24" width="266" height="140" />
        {[-60, -30, 0, 30, 60].map((lat) => (
          <path
            className="diagram-grid"
            key={lat}
            d={`M17 ${94 - (lat / 90) * 70}h266`}
          />
        ))}
        {[-120, -60, 0, 60, 120].map((lon) => (
          <path
            className="diagram-grid"
            key={lon}
            d={`M${150 + (lon / 180) * 133} 24v140`}
          />
        ))}
        <text x="17" y="16">
          180°W
        </text>
        <text x="283" y="16" textAnchor="end">
          180°E
        </text>
        <text x="12" y="97" textAnchor="end">
          0
        </text>
        <path className="ground-track" d={makePath(true)} />
        <path className="ground-track future" d={makePath(false)} />
        <circle className="focus-ring" cx={here.x} cy={here.y} r="5" />
        <text x={Math.min(260, here.x + 7)} y={here.y + 15}>
          YOU
        </text>
        {current && (
          <rect
            className="satellite-bracket"
            x={current.x - 4}
            y={current.y - 4}
            width="8"
            height="8"
          />
        )}
        <text x="150" y="186" textAnchor="middle">
          SOLID: PAST · DASHED: PREDICTED
        </text>
      </svg>
      <p className="diagram-note">
        Orbital elements: {sat.epoch.slice(0, 10)} UTC.
        <br />
        {object.stale
          ? "Older elements — reduced prediction accuracy."
          : "Position is predicted, not live telemetry."}
      </p>
    </div>
  );
}
export function GalaxyContext({ object }: { object: SkyObject }) {
  const shape = object.morphology || "spiral";
  return (
    <div className="context-diagram galaxy-atlas">
      <div className="diagram-label">
        <span>BEYOND OUR GALAXY</span>
        <span>CONTEXT</span>
      </div>
      <svg
        viewBox="0 0 300 218"
        aria-label="Schematic relationship of the Milky Way and selected galaxy"
      >
        <text className="galaxy-distance" x="150" y="43" textAnchor="middle">
          {object.distance
            ? `${(object.distance / 1e6).toFixed(2)} MILLION LY`
            : "DISTANCE NOT CATALOGUED"}
        </text>
        <text className="galaxy-label" x="150" y="59" textAnchor="middle">
          FROM OUR NEIGHBOURHOOD
        </text>
        <g transform="translate(68 125) rotate(-22) scale(.48 .29)">
          <GalaxyDrawing />
        </g>
        <g
          transform={`translate(232 125) rotate(-22) scale(.5 ${shape === "elliptical" ? ".38" : ".3"})`}
        >
          <GalaxyDrawing shape={shape} />
        </g>
        <path
          className="galaxy-annotation"
          d="M119 122v6M119 125h62M181 122v6"
        />
        <circle className="galaxy-marker" cx="88" cy="118" r="2.5" />
        <text className="galaxy-label" x="68" y="178" textAnchor="middle">
          MILKY WAY
        </text>
        <text className="galaxy-label" x="232" y="178" textAnchor="middle">
          {object.catalogue}
        </text>
        <text className="galaxy-label" x="68" y="194" textAnchor="middle">
          OUR GALAXY
        </text>
        <text className="galaxy-label" x="232" y="194" textAnchor="middle">
          {shape.toUpperCase()}
        </text>
      </svg>
      <p className="diagram-note">
        Illustrative galaxy shapes. Separation and sizes are not to scale.
      </p>
    </div>
  );
}

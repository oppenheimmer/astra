import * as A from "astronomy-engine";
import * as S from "satellite.js";
import { describeSatellite } from "./satellite-info";
import { starPosition } from "./star-catalogue";
import type {
  Catalogue,
  Satellite,
  SatelliteData,
  Site,
  Sky,
  SkyObject,
  Star,
} from "./types";
import { RAD, wrap } from "./projection";
const AU_KM = 149597870.7;
export const bodies = [
  "Mercury",
  "Venus",
  "Mars",
  "Jupiter",
  "Saturn",
  "Uranus",
  "Neptune",
  "Moon",
  "Sun",
];
export const planetFacts: Record<
  string,
  { kind: string; fact: string; radius: number; year: string }
> = {
  Mercury: {
    kind: "Rocky planet",
    fact: "The smallest planet. Its heavily cratered surface holds a record of the early Solar System.",
    radius: 2440,
    year: "88 days",
  },
  Venus: {
    kind: "Rocky planet",
    fact: "A dense carbon-dioxide atmosphere and thick clouds make Venus the hottest planet.",
    radius: 6052,
    year: "225 days",
  },
  Earth: {
    kind: "Our home planet",
    fact: "The only world currently known to support life.",
    radius: 6371,
    year: "365.25 days",
  },
  Mars: {
    kind: "Rocky planet",
    fact: "Iron minerals give Mars its reddish appearance. Look for the polar caps when it is near opposition.",
    radius: 3390,
    year: "687 days",
  },
  Jupiter: {
    kind: "Gas giant",
    fact: "Its four bright Galilean moons change position from night to night. A rewarding telescope target.",
    radius: 69911,
    year: "11.9 years",
  },
  Saturn: {
    kind: "Gas giant",
    fact: "Its rings consist mostly of countless pieces of ice. Their apparent tilt changes over Saturn’s orbit.",
    radius: 58232,
    year: "29.4 years",
  },
  Uranus: {
    kind: "Ice giant",
    fact: "Uranus rotates on its side, with its axis tilted by about 98 degrees.",
    radius: 25362,
    year: "84 years",
  },
  Neptune: {
    kind: "Ice giant",
    fact: "The most distant planet. A telescope is needed to see its small blue-grey disc.",
    radius: 24622,
    year: "165 years",
  },
  Moon: {
    kind: "Earth’s natural satellite",
    fact: "The boundary between lunar day and night—the terminator—reveals craters in dramatic relief.",
    radius: 1737,
    year: "27.3 days around Earth",
  },
  Sun: {
    kind: "Our star",
    fact: "Never point an unfiltered telescope at the Sun. Solar slewing is disabled in this prototype.",
    radius: 695700,
    year: "—",
  },
};
const dsoFacts: Record<string, { distance: number; fact: string }> = {
  M31: {
    distance: 2500000,
    fact: "The Andromeda Galaxy, a spiral galaxy in our Local Group. Its faint outer disc spans several full Moons.",
  },
  M33: {
    distance: 2730000,
    fact: "The Triangulum Galaxy is a nearby spiral with low surface brightness; dark skies help.",
  },
  M42: {
    distance: 1344,
    fact: "The Orion Nebula is a stellar nursery. Its glowing gas surrounds the young Trapezium stars.",
  },
  M45: {
    distance: 444,
    fact: "The Pleiades are a young open star cluster. Best enjoyed at low magnification.",
  },
  M51: {
    distance: 31000000,
    fact: "The Whirlpool Galaxy is interacting with its companion. Its spiral structure is a classic imaging target.",
  },
  M81: {
    distance: 11800000,
    fact: "Bode’s Galaxy is a bright spiral, close on the sky to the starburst galaxy M82.",
  },
  M82: {
    distance: 12000000,
    fact: "The Cigar Galaxy is undergoing intense star formation following interactions with M81.",
  },
  M13: {
    distance: 25000,
    fact: "The Great Hercules Cluster is a dense, ancient collection of hundreds of thousands of stars.",
  },
  M57: {
    distance: 2500,
    fact: "The Ring Nebula is the expelled atmosphere of a dying star, with a white dwarf at its centre.",
  },
  M104: {
    distance: 29000000,
    fact: "The Sombrero Galaxy has a prominent central bulge and a dark lane of dust.",
  },
  M87: {
    distance: 55000000,
    fact: "This giant elliptical galaxy contains the supermassive black hole imaged by the Event Horizon Telescope.",
  },
  M1: {
    distance: 6500,
    fact: "The Crab Nebula is the remnant of a supernova recorded in 1054.",
  },
};
export const detailFact = (o: SkyObject) =>
  o.body
    ? planetFacts[o.body]?.fact
    : o.kind === "satellite"
      ? o.satellite
        ? describeSatellite(o.satellite).fact
        : "An Earth-orbiting object."
      : o.catalogue
        ? (dsoFacts[o.catalogue]?.fact ??
          "A deep-sky object in the Messier catalogue. Visibility depends on aperture, sky darkness and surface brightness.")
        : o.star
          ? o.star.source === "Gaia DR3"
            ? "Gaia DR3 measures this star in its broad G band; this can differ from visual magnitude. " +
              (o.star.dist
                ? "Distance is a rough inverse-parallax estimate with parallax signal-to-noise of at least 10."
                : "No reliable distance is available in this sample.")
            : `${o.star.name} is catalogued in ${o.star.con || "the star catalogue"}. Its spectral class is ${o.star.spec || "not recorded"}. Distances are catalogue estimates, not exact measurements.`
          : "";
export function observer(site: Site) {
  return new A.Observer(site.lat, site.lon, site.elevation);
}
export function equatorialToHorizontal(
  ra: number,
  dec: number,
  date: Date,
  site: Site,
) {
  const rotation = A.Rotation_EQJ_HOR(date, observer(site));
  const v = A.VectorFromSphere(new A.Spherical(dec, ra * 15, 1), date);
  const w = A.RotateVector(rotation, v);
  return {
    az: wrap(-Math.atan2(w.y, w.x) / RAD),
    alt: Math.asin(Math.max(-1, Math.min(1, w.z))) / RAD,
  };
}
export function horizontalToEquatorial(
  az: number,
  alt: number,
  date: Date,
  site: Site,
) {
  const v = new A.Vector(
    Math.cos(alt * RAD) * Math.cos(az * RAD),
    -Math.cos(alt * RAD) * Math.sin(az * RAD),
    Math.sin(alt * RAD),
    A.MakeTime(date),
  );
  const e = A.EquatorFromVector(
    A.RotateVector(A.Rotation_HOR_EQJ(date, observer(site)), v),
  );
  return { ra: e.ra, dec: e.dec };
}
/**
 * Orbital elements are refreshed on a schedule, so their epoch is normally less
 * than a day old. Past STALE_DAYS a refresh has been missed and predictions are
 * labelled; past MAX_DAYS the object is not drawn at all, because an SGP4
 * propagation that far from its epoch is a guess, not a position.
 */
export const SATELLITE_STALE_DAYS = 1.5;
export const SATELLITE_MAX_DAYS = 3;

/** Days between an element set's epoch and the observing time, in either direction. */
export function epochAgeDays(epoch: string, date: Date) {
  const stamp = Date.parse(epoch.endsWith("Z") ? epoch : epoch + "Z");
  return Number.isFinite(stamp) ? Math.abs(date.getTime() - stamp) / 86400000 : Infinity;
}

export function prepareSatellites(data: SatelliteData): Satellite[] {
  return [...new Map(data.elements.map(e => [e.NORAD_CAT_ID, e])).values()].flatMap((e) => {
    try {
      return [
        {
          id: "sat" + e.NORAD_CAT_ID,
          name: e.OBJECT_NAME,
          epoch: e.EPOCH,
          record: S.json2satrec(e as any),
          elements: e,
          metadata: data.catalogue?.objects[String(e.NORAD_CAT_ID)] ??
            (/^STARLINK-\d+$/.test(e.OBJECT_NAME) ? {
              objectType: "PAY", owner: "US", launchDate: "", internationalId: e.OBJECT_ID,
            } : undefined),
        },
      ];
    } catch {
      return [];
    }
  });
}
type SatelliteLook = { az: number; alt: number; range: number; height: number;
  lat: number; lon: number; velocity: number; sunlit: boolean };
export function satellitePosition(sat: Satellite, date: Date, site: Site, sunVector?: A.Vector): SatelliteLook | null;
export function satellitePosition(sat: Satellite, date: Date, site: Site, sunVector: A.Vector | undefined,
  frame: ReturnType<typeof satelliteFrame>): (Omit<SatelliteLook, "height" | "lat" | "lon"> & Partial<Pick<SatelliteLook, "height" | "lat" | "lon">>) | null;
export function satellitePosition(
  sat: Satellite,
  date: Date,
  site: Site,
  sunVector?: A.Vector,
  frame?: ReturnType<typeof satelliteFrame>,
) {
  try {
    const pv = frame
      ? S.sgp4(sat.record, (frame.julian - sat.record.jdsatepoch) * 1440)
      : S.propagate(sat.record, date);
    if (
      !pv ||
      !pv.position ||
      typeof pv.position === "boolean" ||
      !pv.velocity ||
      typeof pv.velocity === "boolean"
    )
      return null;
    const gmst = frame?.gmst ?? S.gstime(date),
      ecf = S.eciToEcf(pv.position, gmst),
      geo = !frame || frame.details ? S.eciToGeodetic(pv.position, gmst) : null;
    let look;
    if (frame) {
      const x = ecf.x - frame.origin.x, y = ecf.y - frame.origin.y, z = ecf.z - frame.origin.z;
      const south = frame.sinLat * frame.cosLon * x + frame.sinLat * frame.sinLon * y - frame.cosLat * z;
      const east = -frame.sinLon * x + frame.cosLon * y;
      const up = frame.cosLat * frame.cosLon * x + frame.cosLat * frame.sinLon * y + frame.sinLat * z;
      const rangeSat = Math.sqrt(south * south + east * east + up * up);
      look = { rangeSat, azimuth: Math.atan2(-east, south) + Math.PI, elevation: Math.asin(up / rangeSat) };
    } else look = S.ecfToLookAngles(
      {
        latitude: site.lat * RAD,
        longitude: site.lon * RAD,
        height: site.elevation / 1000,
      },
      ecf,
    );
    const sun = sunVector ?? A.GeoVector(A.Body.Sun, date, true);
    const p = pv.position;
    const proj =
      (p.x * sun.x + p.y * sun.y + p.z * sun.z) /
      Math.hypot(sun.x, sun.y, sun.z);
    const perpendicular = Math.sqrt(
      Math.max(0, p.x * p.x + p.y * p.y + p.z * p.z - proj * proj),
    );
    return {
      az: wrap(look.azimuth / RAD),
      alt: look.elevation / RAD,
      range: look.rangeSat,
      height: geo?.height,
      lat: geo ? geo.latitude / RAD : undefined,
      lon: geo ? geo.longitude / RAD : undefined,
      velocity: Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z),
      sunlit: proj >= 0 || perpendicular > 6378,
    };
  } catch {
    return null;
  }
}
function satelliteFrame(date: Date, site: Site, details: boolean) {
  const latitude = site.lat * RAD, longitude = site.lon * RAD;
  return {
    details, julian: S.jday(date), gmst: S.gstime(date),
    origin: S.geodeticToEcf({ latitude, longitude, height: site.elevation / 1000 }),
    sinLat: Math.sin(latitude), cosLat: Math.cos(latitude),
    sinLon: Math.sin(longitude), cosLon: Math.cos(longitude),
  };
}
type PreparedStar = {
  object: Omit<SkyObject, "az" | "alt">;
  x: number;
  y: number;
  z: number;
};
const starFrames = new WeakMap<
  Star[],
  { minute: number; stars: PreparedStar[] }
>();

function prepareStarFrame(stars: Star[], date: Date) {
  const minute = Math.floor(date.getTime() / 60000);
  const previous = starFrames.get(stars);
  if (previous?.minute === minute) return previous.stars;
  // Proper motion changes negligibly within a minute; horizontal rotation uses every 100 ms tick.
  const year =
    2000 + (minute * 60000 - Date.UTC(2000, 0, 1, 12)) / (365.25 * 86400000);
  const prepared = stars.map((star) => {
    const { ra, dec } = starPosition(star, year);
    const c = Math.cos(dec * RAD),
      a = ra * 15 * RAD;
    const object: Omit<SkyObject, "az" | "alt"> = {
      id: star.id,
      name: star.name,
      kind: "star",
      ra,
      dec,
      mag: star.mag,
      distance: star.dist,
      unit: "ly",
      subtitle: star.source
        ? `Gaia DR3 · G ${star.mag.toFixed(1)}`
        : star.spec || "Catalogued star",
      star,
    };
    return {
      object,
      x: c * Math.cos(a),
      y: c * Math.sin(a),
      z: Math.sin(dec * RAD),
    };
  });
  starFrames.set(stars, { minute, stars: prepared });
  return prepared;
}

export function createSky(
  catalogue: Catalogue,
  satellites: Satellite[],
  date: Date,
  site: Site,
  satelliteDetails = true,
): Sky {
  const obs = observer(site),
    rotation = A.Rotation_EQJ_HOR(date, obs).rot;
  const rotate = (x: number, y: number, z: number) => {
    const hx = rotation[0][0] * x + rotation[1][0] * y + rotation[2][0] * z;
    const hy = rotation[0][1] * x + rotation[1][1] * y + rotation[2][1] * z;
    const hz = rotation[0][2] * x + rotation[1][2] * y + rotation[2][2] * z;
    return {
      az: wrap(-Math.atan2(hy, hx) / RAD),
      alt: Math.asin(Math.max(-1, Math.min(1, hz))) / RAD,
    };
  };
  const toHor = (ra: number, dec: number) => {
    const c = Math.cos(dec * RAD),
      rr = ra * 15 * RAD;
    return rotate(c * Math.cos(rr), c * Math.sin(rr), Math.sin(dec * RAD));
  };
  const objects: SkyObject[] = prepareStarFrame(catalogue.stars, date).map(
    (s) => {
      const o = s.object,
        h = rotate(s.x, s.y, s.z);
      return {
        id: o.id,
        name: o.name,
        kind: "star",
        ra: o.ra,
        dec: o.dec,
        az: h.az,
        alt: h.alt,
        mag: o.mag,
        distance: o.distance,
        unit: "ly",
        subtitle: o.subtitle,
        star: o.star,
      };
    },
  );
  for (const name of bodies) {
    const body = name as A.Body,
      e = A.Equator(body, date, obs, false, true),
      h = toHor(e.ra, e.dec),
      illum = A.Illumination(body, date);
    objects.push({
      id: name,
      name,
      kind: "planet",
      ra: e.ra,
      dec: e.dec,
      ...h,
      mag: illum.mag,
      distance: name === "Moon" ? e.dist * AU_KM : e.dist,
      unit: name === "Moon" ? "km" : "AU",
      subtitle: planetFacts[name].kind,
      body: name,
      angularDiameter:
        name === "Sun" || name === "Moon"
          ? (2 * Math.asin(planetFacts[name].radius / (e.dist * AU_KM))) / RAD
          : undefined,
    });
  }
  for (const feature of catalogue.messier.features) {
    const p = feature.properties,
      [lon, dec] = feature.geometry.coordinates,
      ra = wrap(lon) / 15;
    const kind = ["s", "e", "i", "gx"].includes(p.type)
      ? "galaxy"
      : ["oc", "gc", "sc", "pos"].includes(p.type)
        ? "cluster"
        : "nebula";
    objects.push({
      id: feature.id,
      name: p.alt || feature.id,
      kind,
      ra,
      dec,
      ...toHor(ra, dec),
      mag: p.mag < 90 ? p.mag : 15,
      distance: dsoFacts[feature.id]?.distance ?? null,
      unit: "ly",
      subtitle:
        kind === "galaxy"
          ? "Galaxy"
          : kind === "cluster"
            ? "Star cluster"
            : "Nebula",
      catalogue: feature.id,
      diameter: p.dim,
      morphology:
        p.type === "e"
          ? "elliptical"
          : p.type === "i"
            ? "irregular"
            : kind === "galaxy"
              ? "spiral"
              : undefined,
    });
  }
  const sunVector = satellites.length
    ? A.GeoVector(A.Body.Sun, date, true)
    : undefined;
  const frame = satelliteFrame(date, site, satelliteDetails);
  for (const sat of satellites) {
    const age = epochAgeDays(sat.epoch, date);
    if (age > SATELLITE_MAX_DAYS) continue;
    const p = satellitePosition(sat, date, site, sunVector, frame);
    if (!p) continue;
    // Invert this frame's rotation instead of recalculating it for each satellite.
    const a = p.az * RAD,
      h = p.alt * RAD;
    const hx = Math.cos(h) * Math.cos(a),
      hy = -Math.cos(h) * Math.sin(a),
      hz = Math.sin(h);
    const x = rotation[0][0] * hx + rotation[0][1] * hy + rotation[0][2] * hz;
    const y = rotation[1][0] * hx + rotation[1][1] * hy + rotation[1][2] * hz;
    const z = rotation[2][0] * hx + rotation[2][1] * hy + rotation[2][2] * hz;
    const eq = {
      ra: wrap(Math.atan2(y, x) / RAD) / 15,
      dec: Math.atan2(z, Math.hypot(x, y)) / RAD,
    };
    objects.push({
      id: sat.id,
      name: sat.name,
      kind: "satellite",
      ...eq,
      az: p.az,
      alt: p.alt,
      mag: 3,
      distance: p.range,
      unit: "km",
      subtitle:
        describeSatellite(sat).label + " · NORAD " + sat.elements.NORAD_CAT_ID,
      satellite: sat,
      range: p.range,
      height: p.height,
      velocity: p.velocity,
      sunlit: p.sunlit,
      stale: age > SATELLITE_STALE_DAYS,
    });
  }
  const lines = catalogue.lines.features.map((f: any) => ({
    name: f.id,
    points: f.geometry.coordinates.map((line: number[][]) =>
      line.map(([lon, dec]) => toHor(wrap(lon) / 15, dec)),
    ),
  }));
  const byId = new Map<string, SkyObject>();
  for (const object of objects) byId.set(object.id, object);
  return {
    objects,
    byId,
    sunAltitude: objects.find((o) => o.id === "Sun")!.alt,
    lines,
    count: objects.filter((o) => o.alt > 0).length,
    time: date,
    site,
  };
}
export function nearbyStars(star: Star, stars: Star[]) {
  const nearest: { star: Star; distance: number }[] = [];
  for (const candidate of stars) {
    if (candidate.id === star.id || candidate.dist === null) continue;
    const distance = Math.hypot(candidate.x - star.x, candidate.y - star.y, candidate.z - star.z) * 3.2615638;
    if (nearest.length === 6 && distance >= nearest[5].distance) continue;
    const index = nearest.findIndex(n => n.distance > distance);
    nearest.splice(index < 0 ? nearest.length : index, 0, { star: candidate, distance });
    if (nearest.length > 6) nearest.pop();
  }
  return nearest;
}
export function solarPositions(date: Date) {
  return [
    "Mercury",
    "Venus",
    "Earth",
    "Mars",
    "Jupiter",
    "Saturn",
    "Uranus",
    "Neptune",
  ].map((name) => {
    const v = A.Ecliptic(A.HelioVector(name as A.Body, date));
    return {
      name,
      lon: v.elon,
      lat: v.elat,
      x: v.vec.x,
      y: v.vec.y,
      distance: Math.hypot(v.vec.x, v.vec.y, v.vec.z),
    };
  });
}
// Sample a full revolution near the selected year; display uses linear AU coordinates.
export function solarOrbits(year: number) {
  const start = Date.UTC(year, 0, 1);
  return solarPositions(new Date(start)).map(({ name }) => {
    const period = A.PlanetOrbitalPeriod(name as A.Body) * 86400000;
    const points = Array.from({ length: 161 }, (_, i) => {
      const v = A.Ecliptic(
        A.HelioVector(name as A.Body, new Date(start + (i / 160) * period)),
      );
      return { x: v.vec.x, y: v.vec.y };
    });
    return { name, points };
  });
}
export function nextNight(date: Date, site: Site) {
  const found = A.SearchAltitude(A.Body.Sun, observer(site), -1, date, 3, -12);
  return found
    ? new Date(found.date.getTime() + 3600000)
    : new Date(date.getTime() + 12 * 3600000);
}
export function distanceLabel(o: SkyObject) {
  if (o.distance === null) return "Not catalogued";
  if (o.unit === "ly") {
    if (o.distance >= 1e6) return `${(o.distance / 1e6).toFixed(2)} million ly`;
    return `${o.distance.toLocaleString(undefined, { maximumFractionDigits: o.distance < 100 ? 1 : 0 })} ly`;
  }
  return `${o.distance.toLocaleString(undefined, { maximumFractionDigits: o.unit === "AU" ? 3 : 0 })} ${o.unit}`;
}
export function visibleHighlights(
  sky: Sky,
  limit: number,
  layers: {
    star: boolean;
    planet: boolean;
    galaxy: boolean;
    satellite: boolean;
  },
  starMagnitude = 7.5,
) {
  const score = (o: SkyObject) =>
    o.kind === "planet"
      ? 100 - o.mag
      : o.kind === "satellite"
        ? (o.name.includes("ISS") ? 95 : 40) + o.alt / 10
        : o.catalogue
          ? 60 - o.mag + (dsoFacts[o.id] ? 8 : 0)
          : 35 - o.mag * 3 + (o.star?.named ? 10 : 0);
  return sky.objects
    .filter(
      (o) =>
        o.alt > 8 &&
        o.id !== "Sun" &&
        (o.kind === "star"
          ? layers.star &&
            o.mag <= starMagnitude &&
            (o.star?.named || o.mag < 3)
          : o.kind === "planet"
            ? layers.planet
            : o.kind === "satellite"
              ? layers.satellite && o.sunlit
              : layers.galaxy),
    )
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}

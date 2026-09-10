import type { SatRec } from "satellite.js";

export type Kind =
  "star" | "planet" | "galaxy" | "nebula" | "cluster" | "satellite";
export interface Star {
  source?: "Gaia DR3";
  band?: "G";
  epoch?: number;
  gaiaId?: string;
  id: string;
  hip: string;
  name: string;
  named: boolean;
  ra: number;
  dec: number;
  mag: number;
  dist: number | null;
  spec: string;
  con: string;
  lum: number | null;
  ci: number | null;
  pmra: number | null;
  pmdec: number | null;
  x: number;
  y: number;
  z: number;
}
export interface Site {
  name: string;
  lat: number;
  lon: number;
  elevation: number;
  heightAboveGround?: number;
  preview?: boolean;
}
export interface SkyObject {
  id: string;
  name: string;
  kind: Kind;
  ra: number;
  dec: number;
  az: number;
  alt: number;
  mag: number;
  distance: number | null;
  unit: "ly" | "km" | "AU";
  subtitle: string;
  star?: Star;
  body?: string;
  catalogue?: string;
  diameter?: string;
  /** Apparent diameter in degrees, using the observer's distance. */
  angularDiameter?: number;
  morphology?: "spiral" | "elliptical" | "irregular";
  satellite?: Satellite;
  range?: number;
  height?: number;
  velocity?: number;
  sunlit?: boolean;
  stale?: boolean;
}
/** Validated and normalized CelesTrak elements used by the SGP4 workers. */
export interface OrbitalElements {
  [key: string]: unknown;
  NORAD_CAT_ID: number;
  OBJECT_NAME: string;
  OBJECT_ID: string;
  EPOCH: string;
  MEAN_MOTION: number;
  ECCENTRICITY: number;
  INCLINATION: number;
  RA_OF_ASC_NODE: number;
  ARG_OF_PERICENTER: number;
  MEAN_ANOMALY: number;
  BSTAR: number;
  MEAN_MOTION_DOT: number;
  MEAN_MOTION_DDOT: number;
  ELEMENT_SET_NO: number;
}
export interface Satellite {
  id: string;
  name: string;
  epoch: string;
  record: SatRec;
  elements: OrbitalElements;
  metadata?: SatelliteMetadata;
}
export interface SatelliteMetadata {
  objectType: "PAY" | "R/B" | "DEB" | "UNK";
  owner: string;
  launchDate: string;
  internationalId: string;
}
export interface SatelliteCatalogue {
  fetchedAt: string;
  source: string;
  objects: Record<string, SatelliteMetadata>;
}
export interface SatelliteData {
  fetchedAt: string;
  source: string;
  elements: OrbitalElements[];
  cached?: boolean;
  catalogue?: SatelliteCatalogue;
}
export interface FeatureCollection<Properties, Coordinates> {
  features: {
    id: string;
    properties: Properties;
    geometry: { coordinates: Coordinates };
  }[];
}
export interface Catalogue {
  stars: Star[];
  messier: FeatureCollection<{ type: string; alt: string; mag: number; dim: string }, [number, number]>;
  lines: FeatureCollection<{ rank: string }, [number, number][][]>;
  constellations: FeatureCollection<{ name: string }, [number, number]>;
}
export interface Sky {
  objects: SkyObject[];
  byId: Map<string, SkyObject>;
  sunAltitude: number;
  lines: { name: string; points: { az: number; alt: number }[][] }[];
  count: number;
  time: Date;
  site: Site;
}
export interface View {
  mode: "horizon" | "allsky" | "personal";
  az: number;
  alt: number;
  fov: number;
  roll?: number;
}
export interface TerrainProfile {
  lat: number;
  lon: number;
  heightAboveGround: number;
  groundElevation: number;
  step: number;
  altitudes: number[];
  rangeKm: number;
  source: string;
  approximate: boolean;
}
export interface Telescope {
  connected: boolean;
  ra: number;
  dec: number;
  targetRa: number;
  targetDec: number;
  targetId: string | null;
  moving: boolean;
  tracking: boolean;
  holdAz?: number;
  holdAlt?: number;
  shape: "circle" | "rectangle";
  width: number;
  height: number;
}
export interface Layers {
  star: boolean;
  planet: boolean;
  galaxy: boolean;
  satellite: boolean;
  constellation: boolean;
  grid: boolean;
}

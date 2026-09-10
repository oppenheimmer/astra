import type { OrbitalElements, SatelliteCatalogue, SatelliteData, SatelliteMetadata } from "./types";

const MAX_ELEMENTS = 50000;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const orbitalNumber = (value: unknown): number | null => {
  if (typeof value === "string" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) value = Number(value);
  return finite(value) ? value : null;
};

/** Require a real ISO calendar date; native Date.parse otherwise accepts February 30. */
export function orbitalEpoch(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match || match[1].startsWith("0000-") || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return null;
  const day = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) return null;
  const date = new Date(match[5] ? value : value + "Z");
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function parseOrbitalElements(value: unknown): OrbitalElements | null {
  if (!record(value)) return null;
  const id = typeof value.NORAD_CAT_ID === "string" && /^\d+$/.test(value.NORAD_CAT_ID)
    ? Number(value.NORAD_CAT_ID) : value.NORAD_CAT_ID;
  const epoch = orbitalEpoch(value.EPOCH);
  if (!finite(id) || !Number.isSafeInteger(id) || id <= 0 || !epoch ||
      typeof value.OBJECT_NAME !== "string" || !value.OBJECT_NAME.trim()) return null;
  const fields = ["MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER",
    "MEAN_ANOMALY", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"] as const;
  const parsed = fields.map((field) => [field, orbitalNumber(value[field])] as const);
  if (parsed.some(([, number]) => number === null)) return null;
  const numbers = Object.fromEntries(parsed) as Pick<OrbitalElements, typeof fields[number]>;
  if (numbers.MEAN_MOTION <= 0 || numbers.MEAN_MOTION > 20 || numbers.ECCENTRICITY < 0 || numbers.ECCENTRICITY >= 1 ||
      numbers.INCLINATION < 0 || numbers.INCLINATION > 180 ||
      [numbers.RA_OF_ASC_NODE, numbers.ARG_OF_PERICENTER, numbers.MEAN_ANOMALY].some((v) => v < 0 || v >= 360)) return null;
  const elementSet = orbitalNumber(value.ELEMENT_SET_NO ?? 0);
  if (!finite(elementSet) || !Number.isSafeInteger(elementSet) || elementSet < 0 ||
      (value.OBJECT_ID !== undefined && typeof value.OBJECT_ID !== "string") ||
      (value.CLASSIFICATION_TYPE !== undefined && typeof value.CLASSIFICATION_TYPE !== "string")) return null;
  return { ...numbers, NORAD_CAT_ID: id, EPOCH: epoch, OBJECT_NAME: value.OBJECT_NAME,
    OBJECT_ID: value.OBJECT_ID ?? "", ELEMENT_SET_NO: elementSet };
}

function parseCatalogue(value: unknown): SatelliteCatalogue | null {
  if (!record(value) || typeof value.source !== "string" || typeof value.fetchedAt !== "string" ||
      !record(value.objects) || Object.keys(value.objects).length > MAX_ELEMENTS) return null;
  // A refresh can still publish valid orbits when no metadata snapshot is available.
  if (!orbitalEpoch(value.fetchedAt) && !(value.fetchedAt === "" && Object.keys(value.objects).length === 0)) return null;
  const objects: Record<string, SatelliteMetadata> = {};
  for (const [id, item] of Object.entries(value.objects)) {
    if (!/^\d+$/.test(id) || !record(item) ||
        typeof item.objectType !== "string" || !["PAY", "R/B", "DEB", "UNK"].includes(item.objectType) ||
        typeof item.owner !== "string" || typeof item.launchDate !== "string" || typeof item.internationalId !== "string") return null;
    objects[id] = { objectType: item.objectType as SatelliteMetadata["objectType"], owner: item.owner,
      launchDate: item.launchDate, internationalId: item.internationalId };
  }
  return { fetchedAt: value.fetchedAt, source: value.source, objects };
}

/** Reject the complete response if any element is invalid, preserving the previous healthy snapshot. */
export function parseSatelliteData(value: unknown): SatelliteData | null {
  if (!record(value) || typeof value.fetchedAt !== "string" || !orbitalEpoch(value.fetchedAt) ||
      typeof value.source !== "string" || !Array.isArray(value.elements) ||
      value.elements.length === 0 || value.elements.length > MAX_ELEMENTS ||
      (value.cached !== undefined && typeof value.cached !== "boolean")) return null;
  const elements: OrbitalElements[] = [];
  for (const item of value.elements) {
    const element = parseOrbitalElements(item);
    if (!element) return null;
    elements.push(element);
  }
  const catalogue = value.catalogue === undefined ? undefined : parseCatalogue(value.catalogue);
  if (catalogue === null) return null;
  return { fetchedAt: value.fetchedAt, source: value.source, elements,
    ...(value.cached === undefined ? {} : { cached: value.cached }), ...(catalogue ? { catalogue } : {}) };
}

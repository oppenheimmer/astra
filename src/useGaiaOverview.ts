import { useEffect, useMemo, useState } from "react";
import { horizontalToEquatorial } from "./sky";
import { fieldRadius, OVERVIEW_MAGNITUDE } from "./star-catalogue";
import { RAD } from "./projection";
import type { Site, Star, View } from "./types";
import { fetchGaiaOverview, type PackedOverview } from "./api";

const EMPTY: Star[] = [];

export function unpackOverview(data: PackedOverview) {
  if (data.source !== "Gaia DR3" || data.epoch !== 2016 || data.magnitude !== OVERVIEW_MAGNITUDE ||
      !Array.isArray(data.rows) || data.rows.length !== data.count || data.count > 200000)
    throw Error("Invalid Gaia overview.");
  const vectors = new Float64Array(data.count * 3);
  const stars: Star[] = data.rows.map((row, i) => {
    const [id, hip, ra, dec, mag, distance, pmra, pmdec] = row;
    if (!/^\d+$/.test(id) || typeof id !== "string" ||
        ![ra, dec, mag].every(Number.isFinite) || ra < 0 || ra > 24 || Math.abs(dec) > 90 ||
        mag < 7.5 || mag > OVERVIEW_MAGNITUDE ||
        [distance, pmra, pmdec].some(v => v !== null && !Number.isFinite(v)))
      throw Error("Invalid Gaia overview star.");
    const a = ra * 15 * RAD, d = dec * RAD;
    const x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
    vectors.set([x, y, z], i * 3);
    const pc = (distance ?? 0) / 3.2615638;
    return {
      id: `gaia${id}`, gaiaId: id, hip, name: `Gaia DR3 ${id}`, named: false,
      source: "Gaia DR3", band: "G", epoch: 2016, ra, dec, mag, dist: distance,
      pmra, pmdec, x: pc * x, y: pc * y, z: pc * z,
      spec: "", con: "", lum: null, ci: null,
    };
  });
  return { stars, vectors };
}
type Overview = ReturnType<typeof unpackOverview>;
let pending: Promise<Overview> | null = null;
function loadOverview() {
  if (!pending) {
    pending = fetchGaiaOverview().then(unpackOverview).catch(error => { pending = null; throw error; });
  }
  return pending;
}

export function useGaiaOverview(view: View, time: number, site: Site, magnitude: number, enabled: boolean) {
  const active = enabled && magnitude > 7.5;
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setError("");
    loadOverview().then(value => { if (!cancelled) setData(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Gaia overview unavailable."); });
    return () => { cancelled = true; };
  }, [active, retry]);
  const tick = Math.floor(time / 10000);
  const limit = Math.min(magnitude, OVERVIEW_MAGNITUDE);
  const stars = useMemo(() => {
    if (!active || !data) return EMPTY;
    const eq = horizontalToEquatorial(
      view.mode === "allsky" ? 180 : view.az,
      view.mode === "allsky" ? 90 : view.alt,
      new Date(tick * 10000), site,
    );
    const a = eq.ra * 15 * RAD, d = eq.dec * RAD;
    const x = Math.cos(d) * Math.cos(a), y = Math.cos(d) * Math.sin(a), z = Math.sin(d);
    // Cull the opposite sky before the 10 Hz transform. Padding covers clock motion
    // and catalogue proper motion; actual chart positions still use each current tick.
    const radius = (view.mode === "allsky" ? 90 : fieldRadius(view)) + 2;
    const minDot = Math.cos(radius * RAD), v = data.vectors;
    // Fixed equal-area ICRS cells keep wide views legible and avoid re-sampling
    // when turning around. The extract is ordered brightest first. Each zoom
    // level quarters the cell area; close views keep the full available sample.
    const field = view.mode === "allsky" ? 180 : view.fov;
    const level = Math.max(0, Math.min(6, Math.ceil(Math.log2(90 / field))));
    const columns = 192 * 2 ** level, rows = 96 * 2 ** level;
    const cells = new Set<number>();
    return data.stars.filter((star, i) => {
      if (star.mag > limit || v[i * 3] * x + v[i * 3 + 1] * y + v[i * 3 + 2] * z < minDot) return false;
      if (field <= 20) return true;
      const cell = Math.min(rows - 1, Math.floor((v[i * 3 + 2] + 1) * rows / 2)) * columns + Math.min(columns - 1, Math.floor(star.ra / 24 * columns));
      if (cells.has(cell)) return false;
      cells.add(cell);
      return true;
    });
  }, [active, data, limit, view.az, view.alt, view.fov, view.mode, tick, site]);
  return { stars, simplified: view.mode === "allsky" || view.fov > 20,
    loading: active && !data && !error, error: active ? error : "", loaded: !!data,
    retry: () => setRetry(n => n + 1) };
}

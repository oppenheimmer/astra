import { useEffect, useState } from "react";
import { fetchSatellites } from "./api";
import { prepareSatellites } from "./sky";
import type { Satellite, SatelliteData } from "./types";

/**
 * Ten minutes is well inside the window in which elements stay usable, and the
 * scheduled upstream refresh is far slower than this, so most polls are a CDN hit.
 */
const REFRESH_MS = 600000;

/**
 * Orbital elements for the chart.
 *
 * The payload arrives already merged and de-duplicated across the visual and
 * Starlink groups, so nothing is combined here. Earlier versions eagerly loaded
 * the bundled snapshots from `/data/` as well; they are no longer fetched,
 * because `fetchSatellites` already falls back to the server's copy of exactly
 * those files, and skipping them saves several megabytes on first load.
 */
export function useSatelliteFeed() {
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [data, setData] = useState<SatelliteData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetchSatellites(controller.signal)
        .then((payload) => {
          if (controller.signal.aborted) return;
          setError("");
          setData(payload);
          setSatellites(prepareSatellites(payload));
        })
        .catch((reason) => {
          // Keep whatever is already plotted; a failed poll must not blank the sky.
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : "Orbital data unavailable.");
        });
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [attempt]);
  return { satellites, data, error, retry: () => setAttempt((value) => value + 1) };
}

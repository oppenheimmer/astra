import { useEffect, useState } from "react";
import { fetchInactive } from "./api";
import { prepareSatellites } from "./sky";
import type { Satellite } from "./types";

/** The layer changes no faster than the active feed, so it polls on the same CDN-friendly interval. */
const REFRESH_MS = 600000;

/**
 * Debris, rocket bodies and inactive satellites, downloaded only while the
 * layer is switched on. Loaded objects are kept when it is switched off, so
 * switching it back on shows them at once while a fresh copy loads.
 */
export function useInactiveSatellites(enabled: boolean) {
  const [satellites, setSatellites] = useState<Satellite[]>([]);
  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = () => {
      setLoading(true);
      fetchInactive(controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setError("");
          setSource(data.source);
          setSatellites(prepareSatellites(data).map((s) => ({ ...s, inactive: true })));
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setError(reason instanceof Error ? reason.message : "Debris and inactive objects unavailable.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, attempt]);
  return { satellites, source, loading, error, retry: () => setAttempt((n) => n + 1) };
}

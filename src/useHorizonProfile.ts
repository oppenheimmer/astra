import { useEffect, useState } from "react";
import { fetchHorizon } from "./api";
import { terrainKey, terrainParams } from "./sites";
import type { Site, TerrainProfile } from "./types";

type Keyed<T> = { key: string; value: T };

/** The mountain skyline for a site, requested only while a view can show it. */
export function useHorizonProfile(site: Site, active: boolean) {
  const key = terrainKey(site);
  const [result, setResult] = useState<Keyed<TerrainProfile> | null>(null),
    [error, setError] = useState<Keyed<string> | null>(null),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active || result?.key === key) return;
    const controller = new AbortController();
    setError(null);
    fetchHorizon(terrainParams(key), controller.signal)
      .then((profile) => {
        if (!controller.signal.aborted) setResult({ key, value: profile });
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError({ key, value: reason instanceof Error ? reason.message : "Mountain outline unavailable." });
      });
    return () => controller.abort();
  }, [key, active, attempt]);
  return {
    profile: result?.key === key ? result.value : null,
    message: error?.key === key ? error.value : "",
    retry: () => setAttempt((n) => n + 1),
  };
}

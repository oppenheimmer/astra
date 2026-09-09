import { useEffect, useMemo, useState } from "react";
import type { Site, Star, View } from "./types";
import { horizontalToEquatorial } from "./sky";
import { fetchDeepStars, type DeepStars } from "./api";
import {
  containsField,
  deepFieldLimit,
  fieldRadius,
  paddedField,
  OVERVIEW_MAGNITUDE,
  type StarField,
} from "./star-catalogue";

const EMPTY: Star[] = [];
const cache = new Map<string, DeepStars>();
const keyOf = (field: StarField) => JSON.stringify(field);

export function useDeepStars(
  view: View,
  time: number,
  site: Site,
  magnitude: number,
  enabled: boolean,
) {
  const eligible =
    enabled &&
    magnitude > OVERVIEW_MAGNITUDE &&
    view.mode !== "allsky" &&
    view.fov <= deepFieldLimit(magnitude);
  const tick = Math.floor(time / 10000);
  const field = useMemo(() => {
    if (!eligible) return null;
    const eq = horizontalToEquatorial(
      view.az,
      view.alt,
      new Date(tick * 10000),
      site,
    );
    return {
      ra: eq.ra * 15,
      dec: eq.dec,
      radius: fieldRadius(view),
      magnitude,
    };
  }, [eligible, view.az, view.alt, view.fov, view.mode, tick, site, magnitude]);
  const [request, setRequest] = useState<StarField | null>(null);
  const [result, setResult] = useState<{ key: string; data: DeepStars } | null>(
    null,
  );
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setRequest((previous) =>
      field
        ? previous && containsField(previous, field)
          ? result?.key === keyOf(previous) && result.data.truncated &&
            paddedField(field).radius < previous.radius * 0.9
            ? paddedField(field)
            : previous
          : paddedField(field)
        : null,
    );
  }, [field, result]);
  const key = request ? keyOf(request) : "";
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    setError(null);
    const cached = cache.get(key);
    if (cached) {
      setResult({ key, data: cached });
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await fetchDeepStars(request, controller.signal);
        if (controller.signal.aborted) return;
        cache.set(key, data);
        if (cache.size > 8) cache.delete(cache.keys().next().value!);
        setResult({ key, data });
      } catch (e) {
        if (!controller.signal.aborted)
          setError({
            key,
            message:
              e instanceof Error ? e.message : "Faint stars unavailable.",
          });
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, request, retry]);
  const current =
    field && request && containsField(request, field) && result?.key === key
      ? result.data
      : null;
  return {
    stars: current?.stars ?? EMPTY,
    truncated: current?.truncated ?? false,
    eligible,
    loading: eligible && !current && error?.key !== key,
    error: eligible && error?.key === key ? error.message : "",
    retry: () => setRetry((n) => n + 1),
  };
}

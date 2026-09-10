import { useEffect, useState } from "react";
import { fetchBundled } from "./api";
import type { Catalogue, Star } from "./types";

/** The bundled HYG stars, Messier objects and constellation figures. */
export function useCatalogue() {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchBundled<Star[]>("stars.json"),
      fetchBundled<Catalogue["messier"]>("messier.json"),
      fetchBundled<Catalogue["lines"]>("constellations.lines.json"),
      fetchBundled<Catalogue["constellations"]>("constellations.json"),
    ])
      .then(([stars, messier, lines, constellations]) => {
        if (!cancelled) setCatalogue({ stars, messier, lines, constellations });
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Catalogue could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { catalogue, error };
}

import { useEffect, useState } from "react";
import type { View } from "./types";

/** Keep the plotted catalogue stable while a pan/zoom gesture is in progress. */
export function useCatalogueView(view: View) {
  const [settled, setSettled] = useState(view);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(view), 180);
    return () => clearTimeout(timer);
  }, [view]);
  return settled;
}

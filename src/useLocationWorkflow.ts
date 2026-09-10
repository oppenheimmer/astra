import { useEffect, useRef, useState, type SetStateAction } from "react";
import { fetchGroundElevation, searchLocations, type Address } from "./api";
import { readSite, saveSite } from "./preferences";
import { observerHeight, previewSite, siteProblem } from "./sites";
import type { Site } from "./types";

type Lookup = "geolocation" | "search" | "elevation";

/** One current location request: every edit, new lookup or close discards older work. */
export function useLocationWorkflow(notify: (message: string) => void) {
  const [site, setSite] = useState<Site>(() => readSite() ?? previewSite());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(site);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Address[]>([]);
  const [pending, setPending] = useState<Lookup | null>(null);
  const request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pendingRef = useRef<Lookup | null>(null);

  function cancel() {
    ++request.current;
    controller.current?.abort();
    controller.current = null;
    pendingRef.current = null;
    setPending(null);
    setResults([]);
    setMessage("");
  }
  function begin(kind: Lookup) {
    cancel();
    const id = request.current;
    const next = new AbortController();
    controller.current = next;
    pendingRef.current = kind;
    setPending(kind);
    return { id, signal: next.signal };
  }
  function finish(id: number) {
    if (id !== request.current) return;
    pendingRef.current = null;
    setPending(null);
  }
  useEffect(() => () => {
    ++request.current;
    controller.current?.abort();
  }, []);

  function edit(next: SetStateAction<Site>) {
    cancel();
    setDraft(next);
  }
  function close() {
    cancel();
    setOpen(false);
  }
  function show() {
    cancel();
    setDraft(site);
    setQuery("");
    setOpen(true);
  }
  function commit(next: Site, warning = "") {
    const problem = siteProblem(next);
    if (problem) {
      setMessage(problem);
      return;
    }
    const saved = { ...next, preview: false };
    cancel();
    setSite(saved);
    setDraft(saved);
    saveSite(saved);
    setOpen(false);
    notify(`Sky updated for ${saved.name}.${warning ? ` ${warning}` : ""}`);
  }
  function apply(next = draft) {
    if (!pendingRef.current) commit(next);
  }
  function changeQuery(value: string) {
    cancel();
    setQuery(value);
  }
  async function search() {
    if (query.trim().length < 3) return;
    const { id, signal } = begin("search");
    try {
      const matches = await searchLocations(query, signal);
      if (id !== request.current) return;
      setResults(matches);
      if (!matches.length) setMessage("No Swiss address found. Try a street, house number and town.");
    } catch (error) {
      if (id === request.current) setMessage(error instanceof Error ? error.message : "Search unavailable.");
    } finally {
      finish(id);
    }
  }
  async function lookupElevation(address?: Address) {
    const next = address
      ? { ...draft, name: address.name, lat: address.lat, lon: address.lon, elevation: 0, preview: false }
      : draft;
    const { id, signal } = begin("elevation");
    if (address) setDraft(next);
    setMessage("Looking up ground elevation…");
    try {
      const value = await fetchGroundElevation(next, address, signal);
      if (id !== request.current) return;
      setDraft((current) => ({ ...current, elevation: value.elevation }));
      setMessage(`Ground elevation: ${value.elevation} m · ${value.source}`);
    } catch (error) {
      if (id === request.current) setMessage(error instanceof Error ? error.message : "Enter elevation manually.");
    } finally {
      finish(id);
    }
  }
  function locate() {
    const { id, signal } = begin("geolocation");
    setOpen(true);
    setMessage("Requesting your browser location…");
    if (!navigator.geolocation) {
      setMessage("Location is unavailable. Enter coordinates below.");
      finish(id);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        if (id !== request.current) return;
        const next: Site = {
          name: "Current location", lat: position.coords.latitude, lon: position.coords.longitude,
          elevation: 0, heightAboveGround: observerHeight(site),
        };
        let warning = "";
        setMessage("Looking up ground elevation…");
        try {
          next.elevation = (await fetchGroundElevation(next, undefined, signal)).elevation;
        } catch {
          warning = "Ground elevation unavailable. You can set it in location settings.";
        }
        if (id !== request.current) return;
        finish(id);
        commit(next, warning);
      },
      () => {
        if (id !== request.current) return;
        setMessage("Location was not available. Check the browser's location permission, or enter coordinates below.");
        finish(id);
      },
      { timeout: 12000, maximumAge: 600000 },
    );
  }

  return {
    site, open, draft, message, query, results, pending, busy: pending !== null,
    edit, close, show, apply, changeQuery, search, lookupElevation, locate, cancel,
  };
}

export type LocationWorkflow = ReturnType<typeof useLocationWorkflow>;

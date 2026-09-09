import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { fetchGroundElevation, searchLocations, type Address } from "./api";
import type { Site } from "./types";
export default function LocationSearch({
  setSite,
  onBusy,
}: {
  setSite: Dispatch<SetStateAction<Site>>;
  onBusy: (busy: boolean) => void;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<Address[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef(0);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  async function search() {
    const id = ++request.current;
    setBusy(true);
    setMessage("");
    setResults([]);
    try {
      const results = await searchLocations(query);
      if (id !== request.current) return;
      setResults(results);
      if (!results.length)
        setMessage(
          "No Swiss address found. Try a street, house number and town.",
        );
    } catch (e) {
      if (id === request.current)
        setMessage(e instanceof Error ? e.message : "Search unavailable.");
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  async function choose(address: Address) {
    const id = ++request.current;
    setResults([]);
    setBusy(true);
    setMessage("Looking up ground elevation…");
    setSite((s) => ({
      ...s,
      name: address.name,
      lat: address.lat,
      lon: address.lon,
      preview: false,
    }));
    try {
      const result = await fetchGroundElevation(address, address);
      if (id !== request.current) return;
      setSite((s) =>
        s.lat === address.lat && s.lon === address.lon
          ? { ...s, elevation: result.elevation }
          : s,
      );
      setMessage(`Ground elevation: ${result.elevation} m · ${result.source}`);
    } catch (e) {
      if (id === request.current)
        setMessage(
          e instanceof Error ? e.message : "Enter elevation manually.",
        );
    } finally {
      if (id === request.current) setBusy(false);
    }
  }
  return (
    <div className="address-lookup">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label htmlFor="address-search">SWISS ADDRESS OR PLACE</label>
        <div className="address-search-row">
          <input
            id="address-search"
            value={query}
            placeholder="Street, house number, town"
            minLength={3}
            maxLength={160}
            onChange={(e) => {
              ++request.current;
              setBusy(false);
              setQuery(e.target.value);
              setResults([]);
              setMessage("");
            }}
          />
          <button type="submit" disabled={query.trim().length < 3 || busy}>
            {busy ? "…" : "FIND ↗"}
          </button>
        </div>
      </form>
      {results.length > 0 && (
        <div className="address-results" aria-label="Address matches">
          {results.map((address, i) => (
            <button key={i} onClick={() => void choose(address)}>
              {address.name} <span>↗</span>
            </button>
          ))}
        </div>
      )}
      {message && (
        <p className="small-note" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

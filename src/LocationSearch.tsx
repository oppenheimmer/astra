import type { LocationWorkflow } from "./useLocationWorkflow";

/** Address input and results share the dialog's current location request. */
export default function LocationSearch({ workflow: p }: { workflow: LocationWorkflow }) {
  return (
    <div className="address-lookup">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void p.search();
        }}
      >
        <label htmlFor="address-search">SWISS ADDRESS OR PLACE</label>
        <div className="address-search-row">
          <input
            id="address-search"
            value={p.query}
            placeholder="Street, house number, town"
            minLength={3}
            maxLength={160}
            onChange={(e) => p.changeQuery(e.target.value)}
          />
          <button type="submit" disabled={p.query.trim().length < 3 || p.busy}>
            {p.pending === "search" ? "…" : "FIND ↗"}
          </button>
        </div>
      </form>
      {p.results.length > 0 && (
        <div className="address-results" aria-label="Address matches">
          {p.results.map((address, i) => (
            <button key={i} onClick={() => void p.lookupElevation(address)}>
              {address.name} <span>↗</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

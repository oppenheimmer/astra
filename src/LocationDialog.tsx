import { timeZoneAt } from "./local-time";
import LocationSearch from "./LocationSearch";
import { observerHeight, presets } from "./sites";
import type { LocationWorkflow } from "./useLocationWorkflow";

/** Choose the observing site: browser location, Swiss address, a preset city, or typed coordinates. */
export default function LocationDialog({ workflow: p }: { workflow: LocationWorkflow }) {
  const { draft, edit: setDraft } = p;
  return (
    <div className="modal-backdrop" onClick={p.close}>
      <div
        className="modal location-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="location-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <h2 id="location-title">YOUR PLACE ON EARTH</h2>
          <button aria-label="Close location settings" onClick={p.close}>
            ×
          </button>
        </div>
        <p>Choose an address, a place or your browser’s location. The clock follows the time zone here.</p>
        <button className="primary" onClick={p.locate}>
          ◎ USE MY CURRENT LOCATION
        </button>
        {p.message && (
          <p className="form-message" role="status">
            {p.message}
          </p>
        )}
        {p.busy && <button type="button" onClick={p.cancel}>CANCEL LOOKUP</button>}
        <LocationSearch workflow={p} />
        <label>
          QUICK LOCATION
          <select
            aria-label="Choose a location"
            value=""
            onChange={(e) => setDraft({ ...presets[+e.target.value], preview: false })}
          >
            <option value="" disabled>
              Choose a city…
            </option>
            {presets.map((preset, i) => (
              <option value={i} key={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            p.apply();
          }}
        >
          <label>
            LOCATION NAME
            <input
              value={draft.name}
              required
              maxLength={40}
              onChange={(e) => setDraft((s) => ({ ...s, name: e.target.value }))}
            />
          </label>
          <div className="form-columns">
            <label>
              LATITUDE
              <input
                aria-label="Latitude"
                type="number"
                step="any"
                min="-90"
                max="90"
                value={draft.lat}
                required
                onChange={(e) => setDraft((s) => ({ ...s, lat: +e.target.value }))}
              />
            </label>
            <label>
              LONGITUDE
              <input
                aria-label="Longitude"
                type="number"
                step="any"
                min="-180"
                max="180"
                value={draft.lon}
                required
                onChange={(e) => setDraft((s) => ({ ...s, lon: +e.target.value }))}
              />
            </label>
          </div>
          <label>
            GROUND ELEVATION / METRES ABOVE SEA LEVEL
            <input
              aria-label="Elevation in metres"
              type="number"
              min="-500"
              max="9000"
              value={draft.elevation}
              onChange={(e) => setDraft((s) => ({ ...s, elevation: +e.target.value }))}
            />
          </label>
          <button type="button" className="lookup-elevation" onClick={() => void p.lookupElevation()}>
            LOOK UP GROUND ELEVATION ↗
          </button>
          <label>
            HEIGHT ABOVE GROUND / METRES
            <input
              aria-label="Height above ground in metres"
              type="number"
              min="0"
              max="500"
              step="0.1"
              value={observerHeight(draft)}
              onChange={(e) => setDraft((s) => ({ ...s, heightAboveGround: +e.target.value }))}
            />
          </label>
          <p className="small-note">
            Include the telescope stand or balcony height. Local time: {timeZoneAt(draft.lat, draft.lon)}.
          </p>
          <button className="primary" type="submit" disabled={p.busy}>
            UPDATE SKY ↗
          </button>
        </form>
      </div>
    </div>
  );
}

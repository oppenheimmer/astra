import { clamp, formatDec, formatRA } from "./projection";
import TelescopeBlueprint from "./TelescopeBlueprint";
import { horizonAltitude } from "./terrain";
import type { Site, SkyObject, TerrainProfile } from "./types";
import { SectionTitle } from "./ui";
import type { FieldPreset, TelescopeSimulator } from "./useTelescopeSimulator";

interface Props {
  hidden: boolean;
  sim: TelescopeSimulator;
  selected: SkyObject | null;
  terrain: TerrainProfile | null;
  date: Date;
  site: Site;
  onSlewToSelected: () => void;
  onPlaceTarget: () => void;
  onZoomToField: () => void;
}

/** Connection, motors, slewing, manual pointing and the angular field of the simulated mount. */
export default function TelescopePanel(p: Props) {
  const { tel, setTel } = p.sim;
  const obstructed = !!(p.terrain && p.selected && p.selected.alt < horizonAltitude(p.terrain, p.selected.az));
  return (
    <section className="telescope-section" hidden={p.hidden}>
      <SectionTitle n="04" aside={<span className="status-dot">{tel.connected ? "●" : "○"}</span>}>
        TELESCOPE
      </SectionTitle>
      <div className="instrument-name">OMC–140 / VIXEN GP</div>
      <div className="sim-label">
        {tel.connected
          ? tel.moving
            ? "SIMULATING SLEW"
            : tel.tracking
              ? "SIMULATING TRACKING"
              : "SIMULATOR STOPPED"
          : "SIMULATOR READY"}
      </div>
      {!p.hidden && <TelescopeBlueprint telescope={tel} date={p.date} site={p.site} />}
      <button className={`connect-button ${tel.connected ? "connected" : ""}`} onClick={p.sim.connect}>
        {tel.connected ? "DISCONNECT SIMULATOR" : "CONNECT SIMULATOR"} <span>↗</span>
      </button>
      <div className="two-buttons motor-buttons">
        <button
          disabled={!tel.connected}
          aria-pressed={tel.connected && tel.tracking}
          aria-label={`Turn telescope motors ${tel.connected && tel.tracking ? "off" : "on"}`}
          onClick={p.sim.toggleMotors}
        >
          MOTORS {tel.connected && tel.tracking ? "ON" : "OFF"}
        </button>
        <button onClick={p.sim.stop} disabled={!tel.connected}>
          ■ STOP
        </button>
      </div>
      <div className="telescope-target">
        <span className="eyebrow">SELECTED TARGET</span>
        <strong title={p.selected?.name}>{p.selected?.name || "Select an object on the map"}</strong>
        {p.selected && <small>{p.selected.alt.toFixed(1)}° ABOVE HORIZON</small>}
      </div>
      <button
        className="telescope-slew primary"
        disabled={!tel.connected || !p.selected || p.selected.alt < 0 || p.selected.id === "Sun" || obstructed}
        onClick={p.onSlewToSelected}
      >
        SLEW TO OBJECT <span>↗</span>
      </button>
      <div className="scope-actions telescope-pointing">
        <button disabled={!tel.connected} className={p.sim.aiming ? "active" : ""} onClick={p.onPlaceTarget}>
          ⌖ PLACE TARGET
        </button>
        <button disabled={!tel.connected} onClick={p.onZoomToField}>
          ZOOM TO FIELD ↗
        </button>
      </div>
      <div className="telescope-readout">
        <span>RA {formatRA(tel.ra)}</span>
        <span>DEC {formatDec(tel.dec)}</span>
        <span>
          {tel.moving
            ? `${p.sim.remaining.toFixed(1)}° TO TARGET`
            : tel.connected && tel.tracking
              ? "TRACKING CURRENT FIELD"
              : "MOTORS STOPPED"}
        </span>
      </div>
      <label className="field-label">
        FIELD OF VIEW
        <select
          aria-label="Field of view preset"
          defaultValue="eyepiece"
          onChange={(e) => p.sim.applyPreset(e.target.value as FieldPreset)}
        >
          <option value="eyepiece">25 mm eyepiece · 0.625°</option>
          <option value="camera">ASI585 sensor · 0.321° × 0.181°</option>
          <option value="wide">Wide demo field · 5°</option>
        </select>
      </label>
      <div className="shape-control">
        <button className={tel.shape === "circle" ? "active" : ""} onClick={() => setTel((t) => ({ ...t, shape: "circle" }))}>
          ◯ CIRCLE
        </button>
        <button className={tel.shape === "rectangle" ? "active" : ""} onClick={() => setTel((t) => ({ ...t, shape: "rectangle" }))}>
          □ FRAME
        </button>
      </div>
      <div className="field-inputs">
        <label>
          WIDTH °
          <input
            aria-label="Field width in degrees"
            type="number"
            min="0.01"
            max="20"
            step="0.01"
            value={tel.width}
            onChange={(e) => setTel((t) => ({ ...t, width: clamp(+e.target.value, 0.01, 20) }))}
          />
        </label>
        <label>
          HEIGHT °
          <input
            aria-label="Field height in degrees"
            type="number"
            min="0.01"
            max="20"
            step="0.01"
            disabled={tel.shape === "circle"}
            value={tel.shape === "circle" ? tel.width : tel.height}
            onChange={(e) => setTel((t) => ({ ...t, height: clamp(+e.target.value, 0.01, 20) }))}
          />
        </label>
      </div>
    </section>
  );
}

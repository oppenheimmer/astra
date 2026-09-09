import { EarthOrbit, GalaxyContext, SolarSystem, StarNeighbourhood } from "./Neighbourhood";
import { formatDec, formatRA } from "./projection";
import { describeSatellite, ownerNames } from "./satellite-info";
import { detailFact, distanceLabel, planetFacts } from "./sky";
import { horizonAltitude } from "./terrain";
import type { Catalogue, Site, SkyObject, Star, TerrainProfile } from "./types";
import { kindLabel, SectionTitle, signature } from "./ui";

interface Props {
  selected: SkyObject | null;
  catalogue: Catalogue | null;
  /** The plotted stars, including loaded Gaia entries, for the neighbourhood diagram. */
  stars: Star[];
  terrain: TerrainProfile | null;
  starMagnitude: number;
  date: Date;
  site: Site;
  onTelescope: () => void;
  onCentre: () => void;
}

/** The right rail: facts, coordinates and a context diagram for the selected object. */
export default function ObjectExplorer(p: Props) {
  const { selected } = p;
  const constellation = selected?.star
    ? p.catalogue?.constellations.features.find((f: any) => f.id === selected.star!.con)?.properties?.name
    : null;
  return (
    <aside className="right-rail">
      <SectionTitle n="05" aside={<span>{selected ? signature(selected.kind, selected.body) : "⌖"}</span>}>
        OBJECT EXPLORER
      </SectionTitle>
      {selected ? (
        <>
          <div className="object-heading">
            <span className="eyebrow">
              {kindLabel(selected)}{" "}
              {selected.catalogue ? `/ ${selected.catalogue}` : selected.star?.hip ? `/ HIP ${selected.star.hip}` : ""}
            </span>
            <h2 className={selected.star?.source ? "catalogue-star-name" : undefined}>{selected.name}</h2>
            <div className="visibility">
              <span className={selected.alt >= 0 ? "visible-mark" : "below-mark"}>
                {selected.alt >= 0 ? "↑ ABOVE HORIZON" : "↓ BELOW HORIZON"}
              </span>
              <span>{selected.alt.toFixed(1)}°</span>
            </div>
          </div>
          <div className="object-stats">
            <div>
              <span>DISTANCE FROM EARTH</span>
              <strong>{distanceLabel(selected)}</strong>
            </div>
            <div>
              <span>APPARENT MAGNITUDE{selected.star?.band ? " / G" : ""}</span>
              <strong>{selected.kind === "satellite" ? "Not modelled" : selected.mag.toFixed(2)}</strong>
            </div>
            {selected.star && (
              <>
                <div>
                  <span>CONSTELLATION</span>
                  <strong>{constellation || selected.star.con || "—"}</strong>
                </div>
                <div>
                  <span>SPECTRAL CLASS</span>
                  <strong>{selected.star.spec || "Not catalogued"}</strong>
                </div>
              </>
            )}
            {selected.body && (
              <div>
                <span>RADIUS / APPROX.</span>
                <strong>{planetFacts[selected.body].radius.toLocaleString()} km</strong>
              </div>
            )}
            {selected.kind === "satellite" && selected.satellite && (
              <>
                <div>
                  <span>OBJECT TYPE</span>
                  <strong>{describeSatellite(selected.satellite).label}</strong>
                </div>
                <div>
                  <span>OWNER / COUNTRY</span>
                  <strong>
                    {ownerNames[selected.satellite.metadata?.owner || ""] ||
                      selected.satellite.metadata?.owner ||
                      "Not catalogued"}
                  </strong>
                </div>
                <div>
                  <span>LAUNCHED</span>
                  <strong>{selected.satellite.metadata?.launchDate || "Not catalogued"}</strong>
                </div>
                <div>
                  <span>ORBITAL ALTITUDE</span>
                  <strong>{selected.height?.toFixed(0)} km</strong>
                </div>
                <div>
                  <span>ORBITAL SPEED</span>
                  <strong>{selected.velocity?.toFixed(2)} km/s</strong>
                </div>
                <div>
                  <span>ILLUMINATION / APPROX.</span>
                  <strong>{selected.sunlit ? "Sunlit" : "In Earth’s shadow"}</strong>
                </div>
              </>
            )}
            {(selected.diameter || selected.angularDiameter) && (
              <div>
                <span>ANGULAR SIZE</span>
                <strong>
                  {selected.angularDiameter ? (selected.angularDiameter * 60).toFixed(1) : selected.diameter} arcmin
                </strong>
              </div>
            )}
          </div>
          {p.terrain && selected.alt >= 0 && selected.alt < horizonAltitude(p.terrain, selected.az) && (
            <p className="terrain-obstruction">BEHIND MOUNTAIN SKYLINE</p>
          )}
          {selected.kind === "star" && selected.mag > p.starMagnitude && (
            <p className="small-note">Not plotted at the current star magnitude limit.</p>
          )}
          <p className="object-fact">{detailFact(selected)}</p>
          {selected.satellite && (
            <div className="satellite-sources">
              <a href={describeSatellite(selected.satellite).source} target="_blank" rel="noreferrer">
                TYPE / MISSION SOURCE ↗
              </a>
              <a
                href={`https://celestrak.org/satcat/records.php?CATNR=${selected.satellite.elements.NORAD_CAT_ID}`}
                target="_blank"
                rel="noreferrer"
              >
                CATALOGUE ↗
              </a>
            </div>
          )}
          <div className="object-actions">
            <button onClick={p.onTelescope}>TELESCOPE CONTROLS ↖</button>
            <button onClick={p.onCentre}>CENTRE IN SKY VIEW</button>
          </div>
          <div className="coordinate-row">
            <span>RA {formatRA(selected.ra)}</span>
            <span>DEC {formatDec(selected.dec)}</span>
          </div>
          {selected.kind === "star" && p.catalogue ? (
            <StarNeighbourhood object={selected} stars={p.stars} />
          ) : selected.kind === "planet" ? (
            <SolarSystem object={selected} date={p.date} />
          ) : selected.kind === "satellite" ? (
            <EarthOrbit object={selected} date={p.date} site={p.site} />
          ) : selected.kind === "galaxy" ? (
            <GalaxyContext object={selected} />
          ) : (
            <div className="context-diagram">
              <div className="diagram-label">WITHIN OUR GALAXY</div>
              <p className="object-fact">
                {selected.kind === "cluster"
                  ? "A collection of stars in the Milky Way."
                  : "A cloud of gas and dust in the Milky Way."}{" "}
                Its position on the sky is marked in the main view.
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="empty-explorer">
          <span>⌖</span>
          <p>Every point has a place.</p>
          <small>Select an object in the sky to explore its neighbourhood.</small>
        </div>
      )}
    </aside>
  );
}

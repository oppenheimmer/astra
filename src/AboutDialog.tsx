import { SATELLITE_MAX_DAYS, SATELLITE_STALE_DAYS } from "./sky";

interface Props {
  /** UTC timestamp of the last orbital-data fetch, when known. */
  fetchedAt?: string;
  onClose: () => void;
}

const Link = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children}
  </a>
);

export default function AboutDialog({ fetchedAt, onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal about-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">
          <h2 id="about-title">A SMALL OBSERVATORY</h2>
          <button aria-label="Close about" onClick={onClose}>
            ×
          </button>
        </div>
        <p>
          Starmap is an observing and controller-interface prototype for an OMC-140 telescope. Sky
          positions are calculated; telescope movement is simulated. No hardware connection is
          implemented.
        </p>
        <h3>AT THE DESK</h3>
        <p>
          Drag to look around. Observer view shows 45° either side of your heading, from horizon to
          zenith; its curved shape keeps the Sun and Moon round. Drag or use ←/→ to turn. Scroll,
          pinch or use +/− to zoom; reset restores the full view. Click a point or search by name.
          Connect the simulator, select an object and slew to it, drag the telescope reticle to a new
          patch of sky, or use Place target. The larger dashed reticle locates the telescope; the
          small solid outline is the actual angular field. Telescope controls are together in the
          Telescope tab of the left panel. Its drawing shows the simulated RA and DEC axes; RA is the
          hour angle around the polar axis. Motors off holds the mount still while the sky moves
          past. Space stops the simulator. Use Light / Dark in the header to change the display
          theme; your choice is saved in this browser.
        </p>
        <h3>THE SKY</h3>
        <p>
          Positions use <Link href="https://github.com/cosinekitty/astronomy">Astronomy Engine</Link>.
          Stars come from{" "}
          <Link href="https://github.com/astronexus/HYG-Database">David Nash’s HYG v4.1</Link> (CC
          BY-SA 4.0); this subset includes stars to magnitude 7.5 plus nearby and named stars. Proper
          motion and precession are included; atmospheric refraction is omitted.
        </p>
        <p>
          Raise Faintest star above 7.5 and zoom closer to load{" "}
          <Link href="https://www.cosmos.esa.int/web/gaia/dr3">Gaia DR3</Link> stars through G
          magnitude 14 for the current field. Faint stars include a whole-sky layer through G9, with
          crowded stars simplified in views wider than 20°. Deeper stars load at fields up to 40° for
          magnitude 10, 20° for magnitude 12, and 10° for magnitude 14. Gaia’s broad G band differs
          from visual magnitude; the slider uses each star’s catalogue band. Fields are capped at the
          brightest 6,000 Gaia entries, with an explicit notice when more exist. Search includes the
          loaded field. Gaia positions use their 2016 reference epoch and proper motion. Distances are
          approximate inverse parallaxes, shown only at signal-to-noise ≥10. HYG counterparts are
          retained using Gaia’s Hipparcos cross-match and a conservative positional match for nearby
          stars without Hipparcos IDs. <Link href="/data/GAIA-ATTRIBUTION.md">Gaia credits</Link>.
        </p>
        <p>
          Constellations and Messier objects:{" "}
          <Link href="https://github.com/ofrohn/d3-celestial">Olaf Frohn’s d3-celestial</Link>{" "}
          (BSD-3-Clause). Additional descriptions and approximate distances draw on{" "}
          <Link href="https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/">
            NASA’s Messier catalogue
          </Link>{" "}
          and <Link href="https://science.nasa.gov/solar-system/">Solar System reference</Link>.
          Stellar-neighbourhood diagrams show nearest objects in the loaded sample, not a complete
          census. Milky Way spiral arms are schematic.
        </p>
        <h3>ORBITING EARTH</h3>
        <p>
          <Link href="https://celestrak.org/NORAD/elements/">CelesTrak</Link> visual and Starlink
          elements are propagated with satellite.js (SGP4). Object types, ownership and launch dates
          come from the CelesTrak SATCAT where available, refreshed at most daily. Starlink craft are
          labelled as communications satellites; unknown launch dates are left blank. Specific mission
          roles link to agency or operator references; undocumented roles remain labelled as
          payloads. Elements are refreshed on a schedule, so the set shown is normally less than a
          day old. Satellite trails can show the current pass of every satellite in view, or be
          hidden together, using All / None in Sky Layers. Predictions more than{" "}
          {SATELLITE_MAX_DAYS} days from an element epoch are not drawn at all, and those more than{" "}
          {SATELLITE_STALE_DAYS} days old are flagged, because propagating far from an epoch gives a
          guess rather than a position. Sunlight/shadow is approximate; brightness, weather and
          atmospheric extinction are not modelled.
        </p>
        <p className="small-note">
          Last orbital-data fetch: {fetchedAt?.slice(0, 19).replace("T", " ") || "unavailable"} UTC.
        </p>
        <h3>MOUNTAINS / LOCAL TIME</h3>
        <p>
          Observer view can show the terrain skyline, sampled every 0.25° out to 200 km, with Earth
          curvature. The outline is approximate: distant ridges use coarser terrain data; buildings,
          trees and atmospheric refraction are omitted. Terrain uses the ground height in its
          elevation grid plus your height above ground.
        </p>
        <p>
          <Link href="https://registry.opendata.aws/terrain-tiles/">Mapzen Terrain Tiles</Link> ·{" "}
          <Link href="/data/TERRAIN-ATTRIBUTION.md">Terrain data credits</Link> ·{" "}
          <Link href="https://www.swisstopo.admin.ch/en/geoservices-with-swisstopo-geodata">
            Swiss address and elevation services: swisstopo
          </Link>
          .
        </p>
        <h3>TYPE / DESIGN</h3>
        <p>
          <Link href="https://departuremono.com/">Departure Mono</Link> by Helena Zhang (SIL Open
          Font License). Inspired by the quiet instrument layout of its specimen site.
        </p>
        <p>
          Observation times use the selected location’s time zone, including daylight-saving
          changes. Your saved location stays in this browser. Coordinates are sent to this server to
          calculate terrain; Swiss address searches and height queries use swisstopo. No tracking or
          analytics. Faint-star lookups send the sky field’s celestial coordinates to the ARI/ESA
          Gaia archives through this server.
        </p>
      </div>
    </div>
  );
}

import { lazy, useEffect, useMemo, useRef, useState } from "react";
import DeferredPanel from "./DeferredPanel";
import type { Layers, SkyObject, Star, View } from "./types";
import {
  createSky,
  horizontalToEquatorial,
  nextNight,
  satellitePosition,
  SATELLITE_MAX_DAYS,
  visibleHighlights,
} from "./sky";
import { clamp, compass, personalView, wrap } from "./projection";
import SkyMap from "./SkyMap";
import type { Theme } from "./theme";
import { isMonospaceFont, MONOSPACE_FONTS } from "./fonts";
import { localDateTime, localDay, timeZoneAt, zoneLabel } from "./local-time";
import {
  initialTheme,
  readSatelliteTrails,
  readStarMagnitude,
  saveSatelliteTrails,
  saveStarMagnitude,
  saveTheme,
} from "./preferences";
import { locationLines, observerHeight } from "./sites";
import { deepFieldLimit, DEEP_MAGNITUDE, OVERVIEW_MAGNITUDE, mergeStars } from "./star-catalogue";
import { horizonAltitude } from "./terrain";
import { LayerSymbol, layerLabels, SectionTitle, signature, type LayerKey } from "./ui";
import { useCatalogue } from "./useCatalogue";
import { useCatalogueView } from "./useCatalogueView";
import { useDeepStars } from "./useDeepStars";
import { useDialogFocus } from "./useDialogFocus";
import { useGaiaOverview } from "./useGaiaOverview";
import { useHorizonProfile } from "./useHorizonProfile";
import { useLocationWorkflow } from "./useLocationWorkflow";
import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { useMonospaceFont } from "./useMonospaceFont";
import { useObservingClock } from "./useObservingClock";
import { useSatelliteFeed } from "./useSatelliteFeed";
import { useSatelliteSky } from "./useSatelliteSky";
import { useTelescopeSimulator } from "./useTelescopeSimulator";
import AboutDialog from "./AboutDialog";
import LocationDialog from "./LocationDialog";
import ObjectExplorer from "./ObjectExplorer";
const TelescopePanel = lazy(() => import("./TelescopePanel"));
import TimeDeck from "./TimeDeck";

const LAYER_KEYS: LayerKey[] = ["star", "planet", "galaxy", "satellite", "constellation", "highlights", "grid"];
const HOME_VIEW: View = { mode: "horizon", az: 180, alt: 42, fov: 110 };
const ALL_LAYERS: Layers = { star: true, planet: true, galaxy: true, satellite: true, constellation: true, grid: true };
type ControlPanel = "sky" | "telescope";
type MobilePanel = "sky" | "controls" | "object";

/** Leaving the all-sky projection starts from a level, unrolled horizon view. */
const fromAllSky = (v: View) => (v.mode === "allsky" ? { az: 180, alt: 90, roll: 0 } : {});

export default function App() {
  const [controlPanel, setControlPanel] = useState<ControlPanel>("sky");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("sky");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const { font, setFont, fontFamily, fontRevision } = useMonospaceFont();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#141513" : "#eeede8");
    saveTheme(theme);
  }, [theme]);

  const { catalogue, error: loadError } = useCatalogue();
  const { satellites, data: satelliteData, error: satelliteError, retry: retrySatellites } = useSatelliteFeed();
  const [toast, setToast] = useState("");
  const location = useLocationWorkflow(setToast);
  const { site, open: siteOpen } = location;
  const workspace = useRef<HTMLDivElement>(null);
  const [telescopeVisited, setTelescopeVisited] = useState(false);
  useEffect(() => {
    if (controlPanel === "telescope") setTelescopeVisited(true);
  }, [controlPanel]);
  const clock = useObservingClock();
  const { time } = clock;
  const [view, setView] = useState<View>(HOME_VIEW),
    [layers, setLayers] = useState<Layers>(ALL_LAYERS);
  const [selectedId, setSelectedId] = useState<string | null>(null),
    [pinnedStar, setPinnedStar] = useState<Star | null>(null),
    [query, setQuery] = useState(""),
    [searchOpen, setSearchOpen] = useState(false),
    [highlight, setHighlight] = useState(true),
    [highlightLimit, setHighlightLimit] = useState(30),
    [about, setAbout] = useState(false);
  const [starMagnitude, setStarMagnitude] = useState(readStarMagnitude);
  useEffect(() => saveStarMagnitude(starMagnitude), [starMagnitude]);
  const [satelliteTrails, setSatelliteTrails] = useState(readSatelliteTrails);
  useEffect(() => saveSatelliteTrails(satelliteTrails), [satelliteTrails]);
  const [terrainEnabled, setTerrainEnabled] = useState(true);
  const terrain = useHorizonProfile(site, view.mode === "personal" && terrainEnabled);
  const activeTerrain = view.mode === "personal" && terrainEnabled ? terrain.profile : null;

  const timeZone = useMemo(() => timeZoneAt(site.lat, site.lon), [site.lat, site.lon]);
  const localDate = useMemo(
    () => localDateTime(Math.floor(time / 1000) * 1000, timeZone),
    [Math.floor(time / 1000), timeZone],
  );
  const localZoneLabel = useMemo(() => zoneLabel(time, timeZone), [Math.floor(time / 60000), timeZone]);
  const day = useMemo(
    () => localDay(time, timeZone),
    [localDate.year, localDate.month, localDate.day, timeZone],
  );
  const satelliteSky = useSatelliteSky(satellites, time, site);
  const date = useMemo(() => new Date(satelliteSky.time), [satelliteSky.time]);
  const catalogueView = useCatalogueView(view);
  const deep = useDeepStars(catalogueView, satelliteSky.time, site, starMagnitude, layers.star);
  const overview = useGaiaOverview(catalogueView, satelliteSky.time, site, starMagnitude, layers.star);
  const chartCatalogue = useMemo(
    () =>
      catalogue
        ? { ...catalogue, stars: mergeStars(catalogue.stars, [...deep.stars, ...overview.stars], pinnedStar) }
        : null,
    [catalogue, deep.stars, overview.stars, pinnedStar],
  );
  const sky = useMemo(() => {
    if (!chartCatalogue) return null;
    const value = createSky(chartCatalogue, satelliteSky.failed ? satellites : [], date, site, false);
    if (!satelliteSky.failed)
      for (const object of satelliteSky.objects) {
        value.objects.push(object);
        value.byId.set(object.id, object);
        if (object.alt > 0) value.count++;
      }
    return value;
  }, [chartCatalogue, satellites, satelliteSky.failed, satelliteSky.objects, date, site]);
  const selected = useMemo(() => {
    const object = sky?.byId.get(selectedId || "") ?? null;
    if (!object?.satellite) return object;
    const detail = satellitePosition(object.satellite, date, site);
    return detail ? { ...object, height: detail.height } : object;
  }, [sky, selectedId, date, site]);
  const highlights = useMemo(
    () => (sky ? visibleHighlights(sky, highlightLimit, layers, starMagnitude) : []),
    [sky, highlightLimit, layers, starMagnitude],
  );
  const sim = useTelescopeSimulator({ sky, date, site, heading: view, notify: setToast });
  const { tel, aiming, setAiming } = sim;

  // Open on the brightest named star well above the horizon, once the catalogue is in.
  const initialized = useRef(false);
  useEffect(() => {
    if (!sky || initialized.current) return;
    const best = sky.objects
      .filter((o) => o.kind === "star" && o.star?.named && o.alt > 20 && o.mag < 2)
      .sort((a, b) => b.alt - a.alt)[0];
    if (best) {
      setSelectedId(best.id);
      setView((v) =>
        v.mode === "personal"
          ? personalView({ ...v, az: best.az })
          : { ...v, az: best.az, alt: clamp(best.alt, 25, 65) },
      );
    }
    initialized.current = true;
  }, [sky]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useWorkspaceShortcuts({
    workspace, modalOpen: siteOpen || about, zoom,
    turn: view.mode === "personal" ? (degrees) => setView((v) => ({ ...v, az: wrap(v.az + degrees) })) : undefined,
    stop: sim.stop,
    search: () => {
      document.getElementById("object-search")?.focus();
      setSearchOpen(true);
    },
    escape: () => {
      setAiming(false);
      setSearchOpen(false);
    },
  });
  useDialogFocus(siteOpen || about, () => {
    location.close();
    setAbout(false);
  });

  function zoom(factor: number) {
    setView((v) =>
      v.mode === "personal"
        ? personalView(v, v.fov * factor)
        : { ...v, ...fromAllSky(v), mode: "horizon", fov: clamp((v.mode === "allsky" ? 150 : v.fov) * factor, 0.1, 170) },
    );
  }
  const resetView = () =>
    setView((v) => (v.mode === "personal" ? personalView(v, 90) : { ...v, fov: 110, alt: 42, roll: 0, mode: "horizon" }));
  const zoomToDeepField = () =>
    setView((v) =>
      v.mode === "personal"
        ? personalView(v, deepFieldLimit(starMagnitude))
        : { ...v, mode: "horizon", fov: deepFieldLimit(starMagnitude), ...fromAllSky(v) },
    );
  /** Bring an object to the chart centre; catalogue stars keep the field narrow enough to stay loaded. */
  function centreView(o: SkyObject, maxAlt: number, minField: number) {
    setView((v) =>
      v.mode === "personal"
        ? personalView({ ...v, az: o.az, alt: o.alt })
        : {
            ...v,
            mode: "horizon",
            az: o.az,
            alt: clamp(o.alt, -30, maxAlt),
            fov: o.star?.source ? Math.min(v.fov, deepFieldLimit(starMagnitude)) : Math.max(minField, v.fov),
          },
    );
  }
  function select(o: SkyObject, center = false) {
    setPinnedStar(o.star?.source === "Gaia DR3" ? o.star : null);
    setSelectedId(o.id);
    setQuery("");
    setSearchOpen(false);
    setMobilePanel("object");
    if (center) {
      centreView(o, 85, 20);
      if (o.alt < 0) setToast(`${o.name} is below your horizon at this time.`);
    }
  }
  function aim(az: number, alt: number) {
    if (alt < 0) {
      setToast("Choose a target above the horizon.");
      return;
    }
    if (activeTerrain && alt < horizonAltitude(activeTerrain, az)) {
      setToast("That direction is behind the mountain skyline.");
      return;
    }
    const eq = horizontalToEquatorial(az, alt, date, site);
    sim.slew(eq.ra, eq.dec);
  }
  function zoomToTelescopeField() {
    const h = sim.horizontal;
    if (h)
      setView((v) =>
        v.mode === "personal"
          ? personalView({ ...v, az: h.az, alt: h.alt }, Math.max(0.15, tel.width * 5))
          : { mode: "horizon", az: h.az, alt: h.alt, fov: Math.max(0.15, tel.width * 5) },
      );
    setMobilePanel("sky");
  }

  const counts = useMemo(() => {
    const c = { star: 0, planet: 0, galaxy: 0, satellite: 0 };
    sky?.objects
      .filter((o) => o.alt >= 0 && (o.kind !== "star" || o.mag <= starMagnitude))
      .forEach((o) => {
        c[o.kind === "nebula" || o.kind === "cluster" ? "galaxy" : o.kind]++;
      });
    return c;
  }, [sky, starMagnitude]);
  const results = useMemo(() => {
    if (!sky || !query.trim()) return [];
    const norm = (s: string) => s.toLowerCase().replace(/\s/g, "");
    const q = norm(query);
    const rank = (o: SkyObject) => {
      const names = [o.name, o.id, o.catalogue || "", o.star?.hip ? "HIP " + o.star.hip : ""].map(norm);
      return names.some((n) => n === q) ? 100 : names.some((n) => n.startsWith(q)) ? 80 : names.some((n) => n.includes(q)) ? 20 : 0;
    };
    return sky.objects
      .map((o) => ({ o, score: rank(o) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.o.mag - b.o.mag)
      .slice(0, 12)
      .map((x) => x.o);
  }, [sky, query]);
  const satelliteHidden = satelliteData && !sky?.objects.some((o) => o.kind === "satellite");
  const hemisphere = (value: number, positive: string, negative: string) => (value >= 0 ? positive : negative);

  return (
    <div className="app-shell" ref={workspace}>
      <header className="masthead">
        <div className="earth-time">
          <span className="eyebrow" title={timeZone}>
            {localZoneLabel}
          </span>
          <span className="clock">
            {String(localDate.hour).padStart(2, "0")}:{String(localDate.minute).padStart(2, "0")}:
            {String(localDate.second).padStart(2, "0")}
          </span>
          <span className="date-label">{localDate.toPlainDate().toString()}</span>
        </div>
        <div className="brand">
          <h1>STARMAP</h1>
        </div>
        <button className="location-top" onClick={location.show}>
          <span className="eyebrow">OBSERVER / {site.preview ? "PREVIEW LOCATION" : "EARTH"}</span>
          <span>{site.name.toUpperCase()} ↗</span>
          <small>
            {Math.abs(site.lat).toFixed(3)}°{hemisphere(site.lat, "N", "S")} &nbsp;{" "}
            {Math.abs(site.lon).toFixed(3)}°{hemisphere(site.lon, "E", "W")}
          </small>
        </button>
        <button
          className="theme-toggle"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        >
          {theme === "dark" ? "☼ LIGHT" : "◐ DARK"}
        </button>
      </header>
      <nav className="mobile-tabs" aria-label="Workspace panels">
        {(["sky", "controls", "object"] as const).map((tab) => (
          <button className={mobilePanel === tab ? "active" : ""} key={tab} onClick={() => setMobilePanel(tab)}>
            {tab.toUpperCase()}
          </button>
        ))}
      </nav>
      <main className={`workspace mobile-${mobilePanel}`}>
        <aside className="left-rail">
          <label className="field-label font-picker">
            MONOSPACE FONT
            <select
              aria-label="Monospace font"
              value={font}
              title="Uses locally installed fonts, with a system monospace fallback."
              onChange={(event) => {
                if (isMonospaceFont(event.target.value)) setFont(event.target.value);
              }}
            >
              {MONOSPACE_FONTS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="control-panel-tabs" role="group" aria-label="Control panel">
            <button aria-pressed={controlPanel === "sky"} className={controlPanel === "sky" ? "active" : ""} onClick={() => setControlPanel("sky")}>SKY</button>
            <button aria-pressed={controlPanel === "telescope"} className={controlPanel === "telescope" ? "active" : ""} onClick={() => setControlPanel("telescope")}>TELESCOPE</button>
          </div>
          <div className="sky-controls" hidden={controlPanel !== "sky"}>
            <section>
              <SectionTitle n="01">OBSERVATION</SectionTitle>
              <button className="location-card" onClick={location.show}>
                <span className="location-address">
                  {locationLines(site.name).map((line, i) => <span key={i}>{line}</span>)}
                </span>
                <span className="location-edit">EDIT ↗</span>
              </button>
              <p className="small-note">
                {site.preview
                  ? "Set your location to see your own sky."
                  : `${Math.abs(site.lat).toFixed(4)}° ${hemisphere(site.lat, "N", "S")} / ${Math.abs(site.lon).toFixed(4)}° ${hemisphere(site.lon, "E", "W")}`}
              </p>
              <div className="two-buttons">
                <button
                  onClick={() => {
                    location.show();
                    location.locate();
                  }}
                >
                  ◎ LOCATE ME
                </button>
                <button
                  onClick={() => {
                    clock.preview(nextNight(date, site).getTime());
                    setToast("Previewing the next evening after nautical twilight.");
                  }}
                >
                  TONIGHT ↗
                </button>
              </div>
            </section>
            <section>
              <SectionTitle
                n="02"
                aside={
                  <span title="Counts cover the loaded catalogue above the horizon">
                    {starMagnitude > 7.5 ? "LOADED ↑" : "ABOVE HORIZON"}
                  </span>
                }
              >
                SKY LAYERS
              </SectionTitle>
              <div className="layer-list" role="group" aria-label="Sky layers">
                {LAYER_KEYS.map((k) => (
                  <label className="layer-row" key={k}>
                    <input
                      type="checkbox"
                      aria-label={layerLabels[k]}
                      checked={k === "highlights" ? highlight : layers[k]}
                      onChange={(e) =>
                        k === "highlights" ? setHighlight(e.target.checked) : setLayers((l) => ({ ...l, [k]: e.target.checked }))
                      }
                    />
                    <span className={`object-symbol ${k}`} aria-hidden="true"><LayerSymbol kind={k} /></span>
                    <span>{layerLabels[k]}</span>
                    {(k === "star" || k === "planet" || k === "galaxy" || k === "satellite") && (
                      <span className="count" aria-hidden="true">{String(counts[k]).padStart(2, "0")}</span>
                    )}
                  </label>
                ))}
              </div>
              <div className="satellite-trails-control">
                <span id="satellite-trails-label">Satellite trails</span>
                <div role="group" aria-labelledby="satellite-trails-label">
                  <button aria-pressed={satelliteTrails} disabled={!layers.satellite} onClick={() => setSatelliteTrails(true)}>ALL</button>
                  <button aria-pressed={!satelliteTrails} disabled={!layers.satellite} onClick={() => setSatelliteTrails(false)}>NONE</button>
                </div>
              </div>
              <div className={`star-cutoff ${layers.star ? "" : "disabled"}`}>
                <div className="range-heading">
                  <label htmlFor="star-magnitude">Faintest star</label>
                  <output htmlFor="star-magnitude">MAG {starMagnitude.toFixed(1)}</output>
                </div>
                <input
                  id="star-magnitude"
                  aria-label="Faintest displayed star magnitude"
                  type="range"
                  min="-1.5"
                  max={DEEP_MAGNITUDE}
                  step="0.1"
                  disabled={!layers.star}
                  value={starMagnitude}
                  aria-valuetext={`Magnitude ${starMagnitude.toFixed(1)} and brighter`}
                  onChange={(e) => setStarMagnitude(+e.target.value)}
                />
                <div className="range-labels">
                  <span>BRIGHTER</span>
                  <span>FAINTER</span>
                </div>
                <p className="small-note">
                  Higher values show fainter stars. Gaia covers the whole sky to G 9, with deeper fields to G 14 as you zoom.
                </p>
                {layers.star && starMagnitude > 7.5 && (
                  <div className="deep-star-status small-note" role="status">
                    {overview.error ? (
                      <>{overview.error} <button onClick={overview.retry}>RETRY OVERVIEW ↗</button></>
                    ) : overview.loading ? (
                      "Loading Gaia whole-sky layer…"
                    ) : !deep.eligible ? (
                      <>
                        Gaia whole-sky layer loaded through G {Math.min(starMagnitude, OVERVIEW_MAGNITUDE).toFixed(1)}.
                        {overview.simplified && " Crowded stars are simplified at this zoom."}
                        {starMagnitude > OVERVIEW_MAGNITUDE && (
                          <>
                            {" "}Zoom to {deepFieldLimit(starMagnitude)}° for stars through G {starMagnitude.toFixed(1)}.
                            <button onClick={zoomToDeepField}>ZOOM FOR FAINT STARS ↗</button>
                          </>
                        )}
                      </>
                    ) : deep.error ? (
                      <>{deep.error} <button onClick={deep.retry}>RETRY GAIA ↗</button></>
                    ) : deep.loading ? (
                      "Loading faint stars for this field…"
                    ) : deep.truncated ? (
                      "Dense field: Gaia returned the brightest 6,000 entries. Zoom closer to load the fainter ones."
                    ) : (
                      "Gaia field loaded. Brightness uses Gaia’s G band; it differs from visual magnitude."
                    )}
                  </div>
                )}
              </div>
              {satelliteError && (
                <p className="small-note" role="status">
                  {satelliteData ? "Orbital refresh failed. Keeping the last loaded data. " : "Satellites unavailable. "}
                  {satelliteError} <button onClick={retrySatellites}>RETRY SATELLITES ↗</button>
                </p>
              )}
              {satelliteHidden && (
                <p className="small-note">
                  Satellite predictions unavailable for this date. Choose a date within {SATELLITE_MAX_DAYS} days of the orbit data.
                </p>
              )}
            </section>
            <section>
              <SectionTitle n="03">HIGHLIGHTS</SectionTitle>
              <div className="range-heading">
                <span>Things worth a look</span>
                <strong>{highlightLimit}</strong>
              </div>
              <input
                aria-label="Highlight limit"
                type="range"
                min="20"
                max="100"
                step="5"
                value={highlightLimit}
                onChange={(e) => setHighlightLimit(+e.target.value)}
              />
              <div className="range-labels">
                <span>20 / QUIET</span>
                <span>100 / EXPLORE</span>
              </div>
              <p className="small-note">Labels adapt to the available space.</p>
              <div className="suggestions">
                {highlights.slice(0, 4).map((o) => (
                  <button key={o.id} onClick={() => select(o, true)}>
                    <span>
                      {signature(o.kind, o.body)} {o.catalogue || o.name}
                    </span>
                    <span>{Math.round(o.alt)}° ↗</span>
                  </button>
                ))}
              </div>
            </section>
          </div>
          {(telescopeVisited || controlPanel === "telescope") && (
            <DeferredPanel label="Telescope controls" hidden={controlPanel !== "telescope"}>
          <TelescopePanel
            hidden={controlPanel !== "telescope"}
            sim={sim}
            selected={selected}
            terrain={activeTerrain}
            date={date}
            site={site}
            onSlewToSelected={() => {
              if (selected) sim.slew(selected.ra, selected.dec, selected.id);
              setMobilePanel("sky");
            }}
            onPlaceTarget={() => {
              setAiming(!aiming);
              setMobilePanel("sky");
            }}
            onZoomToField={zoomToTelescopeField}
          />
            </DeferredPanel>
          )}
          <button className="about-link" onClick={() => setAbout(true)}>
            ABOUT / DATA & CONTROLS ↗
          </button>
        </aside>
        <section className={`sky-stage ${view.mode === "personal" ? "personal-stage" : ""}`}>
          <div className="stage-top">
            <div className="view-switch" role="group" aria-label="Sky projection">
              <button className={view.mode === "personal" ? "active" : ""} aria-pressed={view.mode === "personal"} onClick={() => setView((v) => personalView(v, 90))}>
                OBSERVER VIEW
              </button>
              <button className={view.mode === "horizon" ? "active" : ""} aria-pressed={view.mode === "horizon"} onClick={() => setView((v) => ({ ...v, mode: "horizon" }))}>
                HORIZON
              </button>
              <button className={view.mode === "allsky" ? "active" : ""} aria-pressed={view.mode === "allsky"} onClick={() => setView((v) => ({ ...v, mode: "allsky" }))}>
                ALL SKY
              </button>
            </div>
          </div>
          <div className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              id="object-search"
              aria-label="Search sky objects"
              placeholder="Find a star, planet, galaxy or satellite…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results[0]) select(results[0], true);
                if (e.key === "Escape") setSearchOpen(false);
              }}
            />
            <kbd>/</kbd>
            {searchOpen && query && (
              <div className="search-results">
                {results.length ? (
                  results.map((o) => (
                    <button key={o.id} onClick={() => select(o, true)}>
                      <span>
                        {signature(o.kind, o.body)} {o.name} {o.catalogue && o.name !== o.catalogue ? `/ ${o.catalogue}` : ""}
                      </span>
                      <small>{o.alt >= 0 ? `${Math.round(o.alt)}° UP` : "BELOW HORIZON"}</small>
                    </button>
                  ))
                ) : (
                  <p>No match in this catalogue.</p>
                )}
              </div>
            )}
          </div>
          <div className="map-area">
            {sky ? (
              <SkyMap
                theme={theme}
                fontFamily={fontFamily}
                fontRevision={fontRevision}
                sky={sky}
                view={view}
                setView={setView}
                layers={layers}
                satelliteTrails={satelliteTrails}
                highlights={highlights}
                selected={selected}
                select={select}
                telescope={tel}
                aiming={aiming}
                aim={aim}
                showHighlights={highlight}
                terrain={activeTerrain}
                starMagnitude={starMagnitude}
              />
            ) : (
              <div className="loading-message">
                {loadError || "Mapping the stars…"}
                {loadError && <button onClick={() => window.location.reload()}>RETRY</button>}
              </div>
            )}
            <div className="map-readout">
              <span className="sky-condition">
                {sky ? (sky.sunAltitude >= 0 ? "DAYLIGHT" : sky.sunAltitude > -18 ? "TWILIGHT" : "NIGHT SKY") : "ACQUIRING SKY"}
              </span>
              <span>
                {view.mode === "personal" ? "FACING" : "AZ"} {view.az.toFixed(1)}°
              </span>
              {view.mode !== "personal" && <span>ALT {view.alt.toFixed(1)}°</span>}
              <span>FIELD {view.mode === "allsky" ? "180" : view.fov.toFixed(view.fov < 10 ? 2 : 0)}°</span>
            </div>
            {view.mode === "personal" && (
              <div className="heading-controls" role="group" aria-label="Direction you are facing">
                <button aria-label="Turn left 15 degrees" onClick={() => setView((v) => ({ ...v, az: wrap(v.az - 15) }))}>
                  ←
                </button>
                <span aria-live="polite">
                  {compass(view.az)} · {view.az.toFixed(0)}°
                </span>
                <button aria-label="Turn right 15 degrees" onClick={() => setView((v) => ({ ...v, az: wrap(v.az + 15) }))}>
                  →
                </button>
              </div>
            )}
            {view.mode === "personal" && (
              <div className="terrain-controls">
                <button aria-pressed={terrainEnabled} onClick={() => setTerrainEnabled((v) => !v)}>
                  MOUNTAINS {terrainEnabled ? "ON" : "OFF"}
                </button>
                {terrainEnabled && <span role="status">{terrain.profile ? "" : terrain.message || "TRACING SKYLINE…"}</span>}
                {terrainEnabled && terrain.message && <button onClick={terrain.retry}>RETRY</button>}
              </div>
            )}
            <div className="zoom-controls">
              <button aria-label="Zoom in" onClick={() => zoom(0.6)}>
                +
              </button>
              <button aria-label="Zoom out" onClick={() => zoom(1.6)}>
                −
              </button>
              <button aria-label="Reset sky view" onClick={resetView}>
                ↺
              </button>
            </div>
            {sky && sky.sunAltitude > 0 && (
              <div className="daylight-note">SUN {sky.sunAltitude.toFixed(0)}° ABOVE HORIZON / STARS SHOWN FOR PLANNING</div>
            )}
          </div>
          <div className="map-caption">
            <span>
              {aiming
                ? "CLICK OR DRAG TO PLACE A SLEW TARGET"
                : tel.connected
                  ? "DRAG THE RETICLE TO SLEW · SCROLL TO ZOOM"
                  : view.mode === "personal"
                    ? "DRAG OR ← → TO TURN · SCROLL TO ZOOM"
                    : "DRAG TO LOOK · SCROLL TO ZOOM · CLICK TO EXPLORE"}
            </span>
            <span>{highlight ? "HIGHLIGHTS ON" : "HIGHLIGHTS OFF"}</span>
          </div>
        </section>
        <ObjectExplorer
          selected={selected}
          catalogue={catalogue}
          stars={chartCatalogue?.stars ?? catalogue?.stars ?? []}
          terrain={activeTerrain}
          starMagnitude={starMagnitude}
          date={date}
          site={site}
          onTelescope={() => {
            setControlPanel("telescope");
            setMobilePanel("controls");
          }}
          onCentre={() => {
            if (selected) centreView(selected, 89, 12);
            setMobilePanel("sky");
          }}
        />
      </main>
      <TimeDeck
        clock={clock}
        timeZone={timeZone}
        zoneLabel={localZoneLabel}
        localDate={localDate}
        day={day}
        siteName={site.name}
        notify={setToast}
      />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {siteOpen && <LocationDialog workflow={location} />}
      {about && <AboutDialog fetchedAt={satelliteData?.fetchedAt} onClose={() => setAbout(false)} />}
    </div>
  );
}

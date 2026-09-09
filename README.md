# Starmap

An interactive sky map and telescope-controller prototype for an Orion Optics OMC-140 on a Vixen GP mount. Inspired by the monochrome instrument layout of [Departure Mono](https://departuremono.com/).

- Real observing time and location, browser geolocation, manual coordinates, location presets, Swiss address search with ground elevation, and local-time travel and playback.
- 28,352 HYG stars plus a bundled Gaia DR3 whole-sky layer of 140,763 sources at 7.5 < G ≤ 9. Deeper Gaia fields load on demand. Planets, Moon, Sun, all 110 Messier objects, constellations, and timestamped satellite predictions are included.
- Sun and Moon are filled disks at their apparent angular diameter, calculated from topocentric distance. Their size follows zoom and the chart projection; sidebar sizes are in arcminutes. Other planet markers remain symbolic.
- Observer view is an upright, curved triangular sector spanning heading ±45° and altitude 0–90°. Its stereographic projection preserves circles and local angles, so the Sun and Moon stay round; angular scale varies across the chart. Drag, use the arrow buttons, or press ←/→ to turn through 360°. Zoom stays under the pointer; reset restores the 90° window while keeping your heading.
- Observer view includes an optional mountain skyline: 0.25° samples out to 200 km, from Mapzen Terrain Tiles, including Earth curvature. Buildings, trees and refraction are omitted. Nearby and distant terrain use different resolutions; this is an approximate outline, not survey-grade visibility. Telescope/balcony height above ground is adjustable.
- Stars remain visible beneath the translucent mountain hatching. Hover and selection identify stars behind the skyline; telescope targeting still respects the obstruction.
- A large chart with compact header and controls at its edges; Observer, horizon and all-sky views; drag, scroll, pinch and button zoom; object search and hover information. Scroll zoom preserves the sky point under the cursor; pinch zoom follows the finger midpoint.
- Light and dark modes, saved in the browser, with higher-contrast faint stars in both. A small custom crosshair is forced over the chart and its children, including hover and drag states, with a native crosshair fallback. Map controls retain their normal button cursors.
- Sky positions target ten updates per second during live observation and playback, subject to device performance. Pausing freezes the observing time; the simulator and animated markers remain responsive.
- Satellite pass calculations run in a separate worker and transfer packed samples. Rapid time changes replace pending work, and paths appear only when valid for the displayed time and location. Gaia cross-matches are cached, and catalogue selection follows the displayed sky frame to avoid duplicate work while scrubbing time.
- Adjustable star magnitude cutoff (−1.5 to 14), saved in the browser. Higher values include fainter stars; the chosen cutoff stays fixed when zooming. The Gaia overview is available in every view through G9, with density simplified above 20° to keep the wide map responsive. Deeper queries start at fields ≤40° through G10, ≤20° through G12, and ≤10° through G14. A button zooms directly to the required field. Star counts describe the loaded catalogue above the horizon; searches include the current Gaia field. Dense fields and network failures are labelled explicitly.
- Small dashed-circle galaxy markers, distinct from dotted star clusters. Satellite trails span the current rise-to-set pass: solid past, dashed future, with the blinking current-position brackets. Sky Layers offers All / None for trails, including every satellite in view without a count cap. Trails default to None; a saved choice takes precedence. Hiding trails keeps satellite markers and selection available.
- Stars, planets, deep sky, satellites, constellations, highlights and grid share one checkbox list. Highlights retain an adjustable 20–100 limit with collision-aware labels. The tab bar and observation/layer sections use consistent spacing.
- Simulated telescope slewing and tracking, circular or rectangular angular fields, camera/eyepiece presets, and manual pointing.
- All telescope controls are in the left panel's Telescope tab: connection, motors, stop, slew to selection, manual target, field zoom and field dimensions. An orthographic assembly drawing shows the optical tube and corrector, finder, focuser and eyepiece, tube collars, motor housings, counterweight and braced tripod. Opaque surfaces and varied line weights keep the parts readable in both themes. The assembly and graduated motor dials follow the mount's current hour angle and declination. It is schematic; pier limits, cable wrap and meridian flips are not modelled.
- Solar System, stellar-neighbourhood, Milky Way and satellite ground-track context diagrams. Satellite paths are drawn over Natural Earth's continent outlines on a shared longitude/latitude grid. Stippled galaxy illustrations distinguish spiral, elliptical and irregular catalogue types; galaxy structure is illustrative.

**No telescope hardware is connected or controlled.** The large dashed reticle locates the telescope; the small solid outline is the angular field. The eyepiece preset assumes 25 mm focal length and 50° apparent field on a 2000 mm telescope. The camera preset approximates an 11.2 × 6.3 mm sensor at 2000 mm. Optical distortion and camera rotation are not modelled.

## Run locally

Node 22 or later, and [uv](https://docs.astral.sh/uv/) for the Python side. `uv sync` creates the virtualenv and fetches the interpreter named in `pyproject.toml`, so no Python install is needed first.

```sh
npm ci
uv sync
npm run build
npm run serve          # uvicorn astra.app:app on http://localhost:7860
```

The Python server serves the built `dist/` directory and the JSON API under `/api`. For development, run `npm run api` (FastAPI with reload on port 7861) and `npm run dev` (Vite on port 5173) in two terminals; Vite proxies `/api` to the Python server.

Tests:

```sh
npm test               # vitest: astronomy, projection, catalogue logic, API client, and a mounted-app smoke test
npm run test:api       # unittest: terrain geometry, Gaia parsing, feed caching, request coalescing, HTTP endpoints
```

## Deploy to Vercel

`vercel.json` builds the Vite frontend as static files and runs the FastAPI app from `api/index.py` as a Python serverless function. Requests to `/api/*` are rewritten to that function; the 5 MB Gaia overview is served as a pre-compressed static file with a `Content-Encoding: gzip` header instead of passing through the function.

```sh
vercel link --project astra
vercel --prod
```

New projects on a team inherit its Deployment Protection setting. If the production `*.vercel.app` alias redirects to a Vercel login, set the project's Vercel Authentication to "Only Preview Deployments" (Settings → Deployment Protection) or attach a custom domain.

The Python version and dependencies are declared once, in `pyproject.toml`. That file is also what pins the deployed runtime: Vercel reads the version from it, from `.python-version` or from `Pipfile.lock`, and offers no project setting; with none of them present the serverless runtime quietly drops to 3.12 while the build log still reports 3.14. Nothing else names a version, because uv takes the interpreter from `requires-python` in every environment, and a test fails if a second copy appears.

## Keeping orbital elements fresh

Star, Gaia, Messier and constellation catalogues are release snapshots. They stay correct indefinitely, because proper motion is applied in the browser from each catalogue's epoch, so they ship with the build and never need refreshing.

Orbital elements are different. They are only usable near their epoch, so the chart flags anything older than 1.5 days and refuses to draw past 3 days rather than showing a guessed position. That window has to be maintained by something outside the request path: a serverless function cannot persist anything, and a background refresh started while answering a request is killed when the instance freezes.

`.github/workflows/refresh-satellites.yml` runs twice a day. It fetches the CelesTrak groups, merges and de-duplicates them, and publishes one payload to Cloudflare R2, which the browser reads directly through the CDN in front of the bucket. No redeploy is involved, and the origin is not touched.

```sh
set -a && source ~/Desktop/work/earth/.env/r2 && set +a
./scripts/sync_satellites.sh          # same cycle, by hand
```

The bucket is shared with the earth project, which owns the keys at the root. Everything here lives under `astra/`: `astra/satellites.json` is the merged payload the browser loads, and `astra/source/` holds the per-group files a later run falls back on.

Partial failure is expected. CelesTrak answers 403 when the caller already holds its newest elements for a group, which the refresh treats as "nothing to do" rather than an outage, republishing that group's previous file. A first run against an empty prefix falls back to the copies in `public/data/`. Those bundled copies are also what `/api/satellites` serves, which is where the browser looks if the published snapshot is unreachable.

Three repository secrets drive the upload, matching the names the earth project already uses: `R2_ACCOUNT_ID`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. They are only ever exposed to the scheduled and manual triggers, never to pull requests.

## Project layout

- `src/` — React frontend. `App.tsx` wires state together; `api.ts` is the only place that calls the server; hooks (`use*.ts`) own the observing clock, catalogue and satellite loading, terrain requests and the telescope simulator; `TimeDeck`, `TelescopePanel`, `ObjectExplorer`, `LocationDialog` and `AboutDialog` are the large panels.
- `astra/` — FastAPI backend. `app.py` defines the routes; `feeds.py` is the rate-limited snapshot cache behind the satellite feeds; `coalesce.py` shares one computation between identical concurrent terrain or Gaia requests; `terrain.py` and `deep_stars.py` do the numerical work.
- `api/index.py` — Vercel entry point.
- `public/data/` — bundled catalogues and their licences. `scripts/` rebuilds them.
- `tests/` — vitest (`*.test.ts[x]`) and unittest (`test_*.py`).

## Data and limitations

- [HYG v4.1](https://github.com/astronexus/HYG-Database), David Nash / Astronexus. CC BY-SA 4.0. The transformed `public/data/stars.json` catalogue is distributed under that same license. Subset: apparent magnitude ≤7.5, plus named stars and catalogue stars within 25 parsecs. Proper motion and precession are applied. Atmospheric refraction and extinction are omitted. Terrain masking is optional in Observer view. HYG sentinel distances are treated as unknown. Distances are catalogue estimates.
- [Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3), ESA/Gaia/DPAC. [Full credits and transformations](public/data/GAIA-ATTRIBUTION.md). On-demand ICRS cone searches supplement HYG with 7.5 < G ≤ 14. G magnitudes differ from visual V. Gaia’s Hipparcos cross-match preserves HYG identities; non-Hipparcos nearby stars use a conservative one-arcsecond position match at epoch 2016. Distances are rough inverse parallaxes only when parallax S/N ≥10. At most 6,000 Gaia entries per cone, with explicit truncation. There is no completeness claim or uniform photometric band across the combined sample.
- [d3-celestial](https://github.com/ofrohn/d3-celestial), Olaf Frohn. BSD-3-Clause. Messier catalogue and constellation data; license included in `public/data/CELESTIAL-LICENSE.txt`.
- [Astronomy Engine](https://github.com/cosinekitty/astronomy), Don Cross, MIT. Planetary positions and coordinate transforms. Object RA/Dec and simulated mount coordinates are J2000; horizontal positions are for the selected observer and date.
- [CelesTrak](https://celestrak.org/NORAD/elements/), visual and Starlink groups, OMM JSON. Propagated with [satellite.js](https://github.com/shashwatak/satellite-js) (MIT, SGP4). Elements are republished twice daily by a scheduled job, so the set shown is normally less than a day old; a timestamped snapshot is bundled for outages. Predictions beyond +/-3 days of an element epoch are not drawn, and beyond 1.5 days are marked as less reliable. Old elements cannot reliably reconstruct historical passes or predict distant-future passes. SATCAT metadata identifies payloads, rocket bodies and debris, with country/ownership and launch date. The server refreshes this metadata at most daily. Mission roles for identified objects link to NASA, ESA, JAXA, CMSA or operator references; other payloads retain an explicit unspecified-purpose label. Tracks show propagated positions, not observed telemetry. Shadow calculation is approximate. Visibility in the map does not imply naked-eye visibility.
- [Natural Earth](https://www.naturalearthdata.com/), public-domain 1:110m land polygons. [Earth map attribution and transformation](public/data/EARTH-ATTRIBUTION.md). No political borders are drawn.
- [NASA Solar System](https://science.nasa.gov/solar-system/) and [Hubble Messier catalogue](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/): concise factual descriptions and approximate reference values.
- [Departure Mono](https://departuremono.com/), Helena Zhang. SIL Open Font License; font and license bundled.

Neighbourhood diagrams use the available star sample, not a complete census. Galactic-plane projections flatten depth. The Milky Way spiral-arm drawing is schematic, with a Sun–Galactic Centre distance of approximately 8.2 kpc. Solar System diagrams use linear AU coordinates and sampled orbital paths. Full-system and inner-planet scales are selectable; planet markers are enlarged. Planet positions reflect the selected date. Stellar positional estimates are best used near the present era.

Date/time controls use the observing location’s IANA time zone, looked up locally with @photostructure/tz-lookup and converted with Temporal. DST is respected, including 23/25-hour slider days; nonexistent spring times are rejected, and an ambiguous autumn time retains the current offset where possible. The initial site is explicitly a Greenwich preview until the user selects a location. Saved coordinates remain in browser local storage. Coordinates and instrument height are sent to the server for terrain calculation; Swiss address/height lookups call swisstopo. Faint-star requests send celestial field coordinates through the server to the ARI/ESA Gaia archives. There are no analytics.

## Data maintenance

`scripts/fetch_data.py` rebuilds the subset, orbital snapshot and catalogue metadata from attributed upstream sources. `scripts/fetch_satellite_catalogue.py` refreshes only object metadata. Documented mission roles live in `src/satellite-info.ts`, with a source link for each role. Library versions are locked in `package-lock.json`.

Application code is MIT licensed. Data and font retain their own licenses as described above.

## Terrain and elevation

The backend samples [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (Terrarium PNG), at zooms 12, 11, 9 and 8 with increasing distance. [Full data attribution](public/data/TERRAIN-ATTRIBUTION.md). It traces great-circle rays and computes the maximum geometric elevation angle per bearing. Tiles and profiles are cached in bounded memory; at most two profiles and six tile requests run concurrently. Failed lookups are reported, never replaced by fictitious mountains. Coverage is limited to 83°S–83°N; the chart clips negative terrain horizons at 0°. Narrow ridges, terrain within 75 m, and obstructions not represented in the elevation data can be missed.

Horizon calculations use ground height from the same terrain grid plus user-specified height above ground, avoiding offsets between elevation models. Ground elevation for Swiss address matches is queried from [swisstopo](https://docs.geo.admin.ch/access-data/get-point-height.html); manual-coordinate and browser-location lookups use Mapzen. Ground elevation used for sky coordinates remains editable.

`npm run test:api` verifies terrain geometry and tile decoding; `npm test` also covers horizon interpolation and local-time/DST behavior.

## Faint-star and satellite-pass implementation

`astra/deep_stars.py` validates and caches up to 32 Gaia cone results. At most two archive queries run concurrently, with eight pending requests. The browser debounces requests, reuses a padded cone while the view stays inside it, keeps eight field results, aborts stale requests and pins a selected Gaia star so its details remain available after panning. Gaia positions use their reference epoch (2016); HYG uses 2000.

`scripts/build_gaia_overview.py` generates the whole-sky extract as compact rows in a roughly 5.1 MB gzip file, loaded once when the magnitude slider passes 7.5 and cached by the browser. Spatial filtering excludes the opposite sky from the 10 Hz position calculations. At fields above 20°, fixed equal-area ICRS cells retain the brightest Gaia source per cell; each closer zoom level quarters the cell area. At 20° and below the available overview sample is retained without density thinning. HYG stars and the selected star keep their identities. Individual star hit targets and radii remain intact when canvas fills are batched by shade.

Pan and zoom update the camera immediately. Gaia coverage and density selection wait until the view has settled for 180 ms, so every trackpad movement does not rebuild the merged catalogue, proper-motion cache and stellar-neighbourhood diagram. Existing stars continue to move with the observing clock; finer coverage follows after the gesture. Wheel and pinch deltas apply to the latest queued camera state, including multiple events before a render.

Deeper cone radii are bounded at 32°/16°/8° for the G10/G12/G14 tiers, including Observer-view corners and request padding. Each response is still capped at 6,000 sources. Zooming into a truncated result requests a smaller cone so the cap does not prevent progressively fainter stars from loading. The broad overview is a responsive chart, not a claim that every G14 star across the hemisphere has been downloaded.

Satellite paths are cached per satellite and observing site for the continuous pass containing the observing time. Horizon crossings are refined to roughly 10 milliseconds, with additional angular samples near overhead passes. Searches stop after two orbital periods or 48 hours; objects that do not cross the horizon in that interval have bounded partial tracks. Paths use the geometric horizon and remain clipped by terrain in Observer view.

The ordinary satellite layer includes the CelesTrak visual and Starlink groups by default, deduplicated by NORAD catalogue number. The bundled Starlink snapshot has 11,080 objects. Each group is refreshed independently by the scheduled job; a group that fails or reports no new data keeps its previous snapshot. Starlink craft are identified as communications satellites; unknown exact launch dates are left blank. Default visibility follows the same horizon, terrain, layer and orbital-epoch rules as other satellites, without a separate Starlink switch or a sunlight-only restriction.

An exact SGP4 calculation runs in a browser worker. Only a packed numeric frame crosses back to the UI; the main chart's stars, planets and satellite positions share that frame's observing time. Requests coalesce to the newest time if the worker is busy. An unsupported or failed worker falls back to calculation on the UI thread. The observing clock requests 10 updates per second; actual painting depends on device performance and catalogue load. No orbital interpolation is used. Unselected map satellites omit geographic altitude calculations; the selected sidebar and Earth track compute them in full.

`npm test` covers catalogue epoch handling, field coverage at RA wrap/poles, catalogue deduplication, magnitude-dependent request bounds and satellite pass endpoints. Python tests cover Gaia parsing, preserved identifiers, unknown distances, truncation and rejected unbounded queries in addition to terrain geometry.

Star proper-motion coordinates are cached per catalogue and observing minute; horizontal rotation uses the current 100 ms clock tick. Planet and satellite positions use that same current instant. Projection bases and the Sun vector are shared within each frame, and canvas buffers are resized only when their dimensions change. Tests compare cached star positions with independent Astronomy Engine transforms and check that earlier frames remain unchanged.

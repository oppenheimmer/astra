# Starmap

An interactive sky map and telescope-controller prototype for an Orion Optics OMC-140 on a Vixen GP mount. Inspired by the monochrome instrument layout of [Departure Mono](https://departuremono.com/).

- Real observing time and location, browser geolocation, manual coordinates, location presets, Swiss address search with ground elevation, and local-time travel and playback. Location lookups can be cancelled; editing or closing the dialog discards earlier responses, and saving waits for the current lookup to finish.
- 28,352 HYG stars plus a bundled Gaia DR3 whole-sky layer of 140,763 sources at 7.5 < G ≤ 9. Deeper Gaia fields load on demand. Planets, Moon, Sun, all 110 Messier objects, constellations, and timestamped satellite predictions are included.
- Sun and Moon are filled disks at their apparent angular diameter, calculated from topocentric distance. Their size follows zoom and the chart projection; sidebar sizes are in arcminutes. Other planet markers remain symbolic.
- Observer view is an upright, curved triangular sector spanning heading ±45° and altitude 0–90°. Its stereographic projection preserves circles and local angles, so the Sun and Moon stay round; angular scale varies across the chart. Drag, use the arrow buttons, or press ←/→ to turn through 360°. Zoom stays under the pointer; reset restores the 90° window while keeping your heading.
- Observer view includes an optional mountain skyline: 0.25° samples out to 200 km, from Mapzen Terrain Tiles, including Earth curvature. Buildings, trees and refraction are omitted. Nearby and distant terrain use different resolutions; this is an approximate outline, not survey-grade visibility. Telescope/balcony height above ground is adjustable.
- Stars remain visible beneath the translucent mountain hatching. Hover and selection identify stars behind the skyline; telescope targeting still respects the obstruction.
- A large chart with compact header and controls at its edges; Observer, horizon and all-sky views; drag, scroll, pinch and button zoom; object search and hover information. Scroll zoom preserves the sky point under the cursor; pinch zoom follows the finger midpoint.
- Light and dark modes, saved in the browser, with higher-contrast faint stars in both. A monospace font dropdown at the top of Controls saves your choice and applies it to the interface, diagrams and chart labels. Departure Mono is the default; other choices use installed fonts with system monospace fallbacks. A small custom crosshair is forced over the chart and its children, including hover and drag states, with a native crosshair fallback. Map controls retain their normal button cursors.
- Sky positions target ten updates per second during live observation and playback, subject to device performance. Pausing freezes the observing time; the simulator and animated markers remain responsive.
- Satellite pass calculations run in a separate worker and transfer packed samples. Rapid time changes replace pending work, and paths appear only when valid for the displayed time and location. Gaia cross-matches are cached, and catalogue selection follows the displayed sky frame to avoid duplicate work while scrubbing time.
- Adjustable star magnitude cutoff (−1.5 to 14), saved in the browser. Higher values include fainter stars; the chosen cutoff stays fixed when zooming. The Gaia overview is available in every view through G9, with density simplified above 20° to keep the wide map responsive. Deeper queries start at fields ≤40° through G10, ≤20° through G12, and ≤10° through G14. A button zooms directly to the required field. Star counts describe the loaded catalogue above the horizon; searches include the current Gaia field. Dense fields and network failures are labelled explicitly.
- Small dashed-circle galaxy markers, distinct from dotted star clusters. Satellite trails span the current rise-to-set pass: solid past, dashed future, with the blinking current-position brackets. Sky Layers offers All / None for trails, including every satellite in view without a count cap. Trails default to None; a saved choice takes precedence. Hiding trails keeps satellite markers and selection available.
- Stars, planets, deep sky, satellites, constellations, highlights and grid share one checkbox list. Highlights retain an adjustable 20–100 limit with collision-aware labels. The tab bar and observation/layer sections use consistent spacing.
- Keyboard shortcuts apply to the observing workspace and yield to buttons, text fields and open dialogs. Space activates a focused button normally; on the workspace it stops the telescope simulator. Satellite feed failures show a retry control, and date guidance follows the same three-day limit as propagation.
- Simulated telescope slewing and tracking, circular or rectangular angular fields, camera/eyepiece presets, and manual pointing.
- All telescope controls are in the left panel's Telescope tab: connection, motors, stop, slew to selection, manual target, field zoom and field dimensions. An orthographic assembly drawing shows the optical tube and corrector, finder, focuser and eyepiece, tube collars, motor housings, counterweight and braced tripod. Opaque surfaces and varied line weights keep the parts readable in both themes. The assembly and graduated motor dials follow the mount's current hour angle and declination. It is schematic; pier limits, cable wrap and meridian flips are not modelled.
- Solar System, stellar-neighbourhood, Milky Way and satellite ground-track context diagrams. Satellite paths are drawn over Natural Earth's continent outlines on a shared longitude/latitude grid. Stippled galaxy illustrations distinguish spiral, elliptical and irregular catalogue types; galaxy structure is illustrative.

Telescope controls and context diagrams load separately from the initial interface. Telescope settings survive tab changes; a failed optional-panel download leaves the observing desk available with a reload control.

**No telescope hardware is connected or controlled.** The large dashed reticle locates the telescope; the small solid outline is the angular field. The eyepiece preset assumes 25 mm focal length and 50° apparent field on a 2000 mm telescope. The camera preset approximates an 11.2 × 6.3 mm sensor at 2000 mm. Optical distortion and camera rotation are not modelled.

## Requirements

- **Node 24 or later.** Declared in `package.json` as `engines.node`, used by CI and by the deployed build.
- **[uv](https://docs.astral.sh/uv/)** for the Python side. It creates the virtualenv and fetches the interpreter named in `pyproject.toml`, so no Python installation is needed first.

Install uv system-wide, not into the project's own `.venv`, or deleting that directory takes uv with it and `uv sync` cannot rebuild it:

```sh
brew install uv                            # or:
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Optional, for tasks beyond running and testing:

- **[Vercel CLI](https://vercel.com/docs/cli)** to link a project or deploy uncommitted state.
- **[wrangler](https://developers.cloudflare.com/workers/wrangler/)** to deploy the Cloudflare Worker. Available through `npx`, so no install needed.
- **[GitHub CLI](https://cli.github.com/)** for `scripts/set_r2_secrets.sh`.

## Run locally

```sh
npm ci                 # Node dependencies, from package-lock.json
uv sync                # Python interpreter and dependencies, from uv.lock
npm run build          # type-check and bundle into dist/
npm run serve          # uvicorn astra.app:app on http://localhost:7860
```

`npm ci` and `uv sync --locked` are also how you restore the environment after deleting `node_modules` and `.venv`. Both are reproducible from the committed lock files, so nothing is lost by clearing them. Add `uv sync --locked --group ops` if you also need the AWS CLI, which only the manual R2 sync uses.

`npm run serve` serves the built `dist/` directory and the JSON API under `/api`, which is the closest thing to production. For development with hot reload, run two terminals instead:

```sh
npm run api            # FastAPI with reload on port 7861
npm run dev            # Vite on port 5173, proxying /api to the above
```

A fresh clone runs with no credentials and no cloud setup at all. Satellites come from the snapshots in `public/data/` through `/api/satellites`, everything else is bundled, and only the scheduled refresh described below needs any account. Those bundled snapshots age, though, so satellites disappear from the chart once their elements are more than three days old.

## Tests

```sh
npm test               # vitest: astronomy, map gestures, API client, mounted app and R2 Worker
npm run test:api       # unittest: terrain, Gaia parsing, feed caching, coalescing, HTTP, deploy config
```

Both run in CI on every push and pull request via `.github/workflows/test.yml`. Neither needs network access: every upstream is mocked, and the bundled catalogues stand in as fixtures.

Regression tests cover stale geolocation/elevation responses, keyboard and dialog focus, saved fonts and canvas redraws, malformed orbital records, shared request limits, terrain deadlines, and conditional Worker responses on cached GET and HEAD paths.

Dependency auditing runs weekly, on dependency pull requests and on manual dispatch through `.github/workflows/audit.yml`. It checks JavaScript runtime/development dependencies and Python runtime/test/operations dependencies against current advisory databases. CI actions are pinned to commit IDs, and Python CI installs require the committed lockfile to match the manifest. Run the same audit locally with network access:

```sh
npm audit
uv sync --locked --group audit
uv export --locked --no-hashes --no-emit-project --group ops --output-file /tmp/astra-audit-requirements.txt
uv run --no-sync pip-audit --no-deps --disable-pip --requirement /tmp/astra-audit-requirements.txt
```

The audit tool is an optional dependency group; ordinary `uv sync` leaves it out. FastAPI and Starlette are pinned together, including the patched file-response range parser; Requests, Pillow and Vitest were updated with the v1.8 security fixes. Audits fail when their databases report a known vulnerability, so a new advisory requires assessment even when the application tests pass.

## Deploy to Vercel

`vercel.json` builds the Vite frontend to static files and runs the FastAPI app from `api/index.py` as a Python serverless function. `/api/*` is rewritten to that function, except `/api/stars/overview`, which is rewritten to the pre-compressed 5 MB Gaia file and served with a `Content-Encoding: gzip` header so it never passes through the function at all.

The build command also copies the satellite snapshots into `astra/data/`, because the function bundle excludes `public/`, and the server reads them at import. A test fails if a snapshot is read at import but missing from that copy step.

This repository is connected to its Vercel project, so a push to `main` deploys production and a pull request gets a preview. Neither needs the CLI.

```sh
vercel --prod          # only to deploy uncommitted local state
```

The Python version is pinned by `requires-python` in `pyproject.toml`, and that file has to keep it. Vercel reads the version only from `pyproject.toml`, `.python-version` or `Pipfile.lock`, and offers no project setting; with none of them present the serverless runtime quietly drops to 3.12 while the build log still reports 3.14. Nothing else names a version, because uv takes the interpreter from `requires-python` everywhere, and a test fails if a second copy appears.

## Deploying your own copy

A fresh clone deploys to a new Vercel project with no changes. Everything below is only needed for the scheduled satellite refresh, which is optional.

**1. Vercel.** Import the repository at [vercel.com/new](https://vercel.com/new), or link an existing directory:

```sh
vercel link --project <your-project-name>
vercel git connect
```

`vercel git connect` reads the `origin` remote and cannot parse an SSH host alias such as `git@github-you:owner/repo.git`. If you use one, point `origin` at `https://github.com/<owner>/<repo>.git` for the length of that command, then set it back.

New projects on a team inherit its Deployment Protection setting. If the production `*.vercel.app` URL redirects to a Vercel login, set Vercel Authentication to "Only Preview Deployments" under Settings, Deployment Protection, or attach a custom domain.

**2. Storage,** only for the scheduled refresh. Create an R2 bucket, then rename the three places that identify it. A test compares these settings and fails if they disagree:

| File | What to change |
| --- | --- |
| `worker/wrangler.toml` | `name` and `bucket_name` |
| `src/api.ts` | `SATELLITE_DATA_URL` |
| `scripts/sync_satellites.sh` | the `R2_BUCKET` default |

**3. The Worker** that serves the bucket to the browser:

```sh
cd worker && npx wrangler deploy     # browser OAuth on first run
```

It prints `https://<name>.<your-subdomain>.workers.dev`. That address plus `/satellites.json` is what `SATELLITE_DATA_URL` must hold.

**4. Credentials.** Create an R2 API token scoped to the new bucket with object read and write, put it in `.env/r2` as described under Credentials below, and run `./scripts/set_r2_secrets.sh`.

**5. Seed the bucket.** The first run publishes from the bundled snapshots, so it works against an empty bucket:

```sh
gh workflow run refresh-satellites.yml
```

## Keeping orbital elements fresh

Star, Gaia, Messier and constellation catalogues are release snapshots. They stay correct indefinitely, because proper motion is applied in the browser from each catalogue's epoch, so they ship with the build and never need refreshing.

Orbital elements are different. They are only usable near their epoch, so the chart flags anything older than 1.5 days and refuses to draw past 3 days rather than showing a guessed position. That window has to be maintained by something outside the request path: a serverless function cannot persist anything, and a background refresh started while answering a request is killed when the instance freezes.

`.github/workflows/refresh-satellites.yml` runs twice a day, at 01:20 and 13:20 UTC. It fetches the CelesTrak groups, merges and de-duplicates them, and publishes one payload to Cloudflare R2, which the browser reads directly through the Worker in front of the bucket. No redeploy is involved and the origin is not touched. Trigger it by hand with `gh workflow run refresh-satellites.yml`, or run the same cycle locally:

```sh
uv sync --group ops                   # the AWS CLI, kept out of the default env
set -a && source .env/r2 && set +a
./scripts/sync_satellites.sh
```

The bucket holds nothing else, so the objects sit at its root. `satellites.json` is the merged payload the browser loads; `source/` keeps the per-group files a later run falls back on.

The bucket is not read over its built-in `r2.dev` address, which is HTTP/1.1, is not edge cached, and which Cloudflare documents as rate limited and unsuitable for production. `worker/` is a small Cloudflare Worker bound to the bucket that serves it over HTTP/2 and HTTP/3 with edge caching and CORS.

Objects are stored uncompressed and the edge compresses them per client, which is why nothing here sets `Content-Encoding`. The Worker cannot re-encode a body it has already compressed, and the runtime has no brotli decompressor, so storing compressed bodies ends with clients receiving compressed bytes labelled `application/json`.

Partial failure is expected. CelesTrak answers 403 when the caller already holds its newest elements for a group, which the refresh treats as "nothing to do" rather than an outage, republishing that group's previous file. A first run against an empty bucket falls back to the copies in `public/data/`. Those bundled copies are also what `/api/satellites` serves, which is where the browser looks if the published snapshot is unreachable.

Orbital IDs, calendar dates, required SGP4 fields and physical ranges are validated before a snapshot replaces healthy data. Numeric strings and epochs with offsets are normalized. The browser independently checks responses before propagation; missing object metadata still permits valid orbits to load.

### Credentials

Nothing in the repository holds them, and nothing needs to: the scheduled job runs on GitHub's runners and reads three repository secrets, `R2_ACCOUNT_ID`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`. The last two are an R2 API token scoped to the bucket with object read and write; a token scoped elsewhere fails the pull step with `AccessDenied` rather than publishing a partial result. Secrets are exposed only to the scheduled and manual triggers, never to pull requests.

For local runs keep the same three values in `.env/r2`, which the `.env*` rule keeps out of git. The account id is the 32-character hex string in the Cloudflare dashboard sidebar, also printed by `npx wrangler whoami`:

```sh
R2_ACCOUNT_ID=<32-character hex account id>
AWS_ACCESS_KEY_ID=<access key id>
AWS_SECRET_ACCESS_KEY=<secret access key>
```

`./scripts/set_r2_secrets.sh` copies that file into the repository secrets, and is what to re-run after rotating the token. It checks the account id looks right first, because a wrong value surfaces later as `Invalid endpoint` with the value masked in the workflow log.

### CORS

The bucket has no CORS configuration and does not need one. That setting governs the built-in `r2.dev` and S3 endpoints, and the page never touches either: it reads the Worker, which sets the headers itself. The S3 endpoint is used only by the refresh job, server to server, where CORS does not apply.

The Worker applies ETag and modification-date conditions consistently to cached GET, uncached GET and HEAD requests. Matching cache validators return 304; failed preconditions return 412. Malformed object paths return 400, storage failures return a retryable 503, and error responses carry CORS headers without being cached.

## Project layout

- `src/` — React frontend. `App.tsx` wires state together; `api.ts` calls the server; `satellite-data.ts` validates and normalizes orbital responses. Hooks (`use*.ts`) own the observing clock, location workflow, scoped shortcuts, catalogue and satellite loading, terrain requests and the telescope simulator. `SkyMap.tsx` composes rendering, with object/trail layers in `sky-map-layers.ts`, hit testing in `sky-map-hit-testing.ts` and pointer handling in `useSkyMapPointer.ts`. `TimeDeck`, `TelescopePanel`, `ObjectExplorer`, `LocationDialog` and `AboutDialog` are the large panels.
- `astra/` — FastAPI backend. `app.py` defines the routes; `feeds.py` is the rate-limited snapshot cache behind the satellite feeds; `coalesce.py` bounds and shares identical computations and optionally caches successful results; `terrain.py` and `deep_stars.py` do the numerical work.
- `api/index.py` — Vercel entry point, the same app without the static mount.
- `worker/` — Cloudflare Worker serving the R2 bucket to the browser, including the CORS headers the page relies on.
- `public/data/` — bundled catalogues and their licences.
- `scripts/` — `refresh_satellites.py` and `sync_satellites.sh` are the scheduled refresh; `set_r2_secrets.sh` places credentials; `fetch_data.py`, `build_gaia_overview.py`, `build_earth_land.py` and `fetch_satellite_catalogue.py` rebuild the bundled catalogues.
- `tests/` — vitest (`*.test.ts[x]`, `worker.test.js`) and unittest (`test_*.py`), including `test_deployment.py`, which checks the deployment configuration itself.
- `pyproject.toml` — the only declaration of the Python version and dependencies. `uv.lock` and `package-lock.json` pin exact versions.

## Data and limitations

- [HYG v4.1](https://github.com/astronexus/HYG-Database), David Nash / Astronexus. CC BY-SA 4.0. The transformed `public/data/stars.json` catalogue is distributed under that same license. Subset: apparent magnitude ≤7.5, plus named stars and catalogue stars within 25 parsecs. Proper motion and precession are applied. Atmospheric refraction and extinction are omitted. Terrain masking is optional in Observer view. HYG sentinel distances are treated as unknown. Distances are catalogue estimates.
- [Gaia DR3](https://www.cosmos.esa.int/web/gaia/dr3), ESA/Gaia/DPAC. [Full credits and transformations](public/data/GAIA-ATTRIBUTION.md). On-demand ICRS cone searches supplement HYG with 7.5 < G ≤ 14. G magnitudes differ from visual V. Gaia’s Hipparcos cross-match preserves HYG identities; non-Hipparcos nearby stars use a conservative one-arcsecond position match at epoch 2016. Distances are rough inverse parallaxes only when parallax S/N ≥10. At most 6,000 Gaia entries per cone, with explicit truncation. There is no completeness claim or uniform photometric band across the combined sample.
- [d3-celestial](https://github.com/ofrohn/d3-celestial), Olaf Frohn. BSD-3-Clause. Messier catalogue and constellation data; license included in `public/data/CELESTIAL-LICENSE.txt`.
- [Astronomy Engine](https://github.com/cosinekitty/astronomy), Don Cross, MIT. Planetary positions and coordinate transforms. Object RA/Dec and simulated mount coordinates are J2000; horizontal positions are for the selected observer and date.
- [CelesTrak](https://celestrak.org/NORAD/elements/), visual and Starlink groups, OMM JSON. Propagated with [satellite.js](https://github.com/shashwatak/satellite-js) (MIT, SGP4). Elements are republished twice daily by a scheduled job, so the set shown is normally less than a day old; a timestamped snapshot is bundled for outages. Predictions beyond +/-3 days of an element epoch are not drawn, and beyond 1.5 days are marked as less reliable. Old elements cannot reliably reconstruct historical passes or predict distant-future passes. SATCAT metadata identifies payloads, rocket bodies and debris, with country/ownership and launch date, and is refreshed alongside the elements by the same scheduled job. Mission roles for identified objects link to NASA, ESA, JAXA, CMSA or operator references; other payloads retain an explicit unspecified-purpose label. Tracks show propagated positions, not observed telemetry. Shadow calculation is approximate. Visibility in the map does not imply naked-eye visibility.
- [Natural Earth](https://www.naturalearthdata.com/), public-domain 1:110m land polygons. [Earth map attribution and transformation](public/data/EARTH-ATTRIBUTION.md). No political borders are drawn.
- [NASA Solar System](https://science.nasa.gov/solar-system/) and [Hubble Messier catalogue](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-messier-catalog/): concise factual descriptions and approximate reference values.
- [Departure Mono](https://departuremono.com/), Helena Zhang. SIL Open Font License; font and license bundled.

Neighbourhood diagrams use the available star sample, not a complete census. Galactic-plane projections flatten depth. The Milky Way spiral-arm drawing is schematic, with a Sun–Galactic Centre distance of approximately 8.2 kpc. Solar System diagrams use linear AU coordinates and sampled orbital paths. Full-system and inner-planet scales are selectable; planet markers are enlarged. Planet positions reflect the selected date. Stellar positional estimates are best used near the present era.

Date/time controls use the observing location’s IANA time zone, looked up locally with @photostructure/tz-lookup and converted with Temporal. DST is respected, including 23/25-hour slider days; nonexistent spring times are rejected, and an ambiguous autumn time retains the current offset where possible. The initial site is explicitly a Greenwich preview until the user selects a location. Saved coordinates remain in browser local storage. Coordinates and instrument height are sent to the server for terrain calculation; Swiss address/height lookups call swisstopo. Faint-star requests send celestial field coordinates through the server to the ARI/ESA Gaia archives. There are no analytics.

## Data maintenance

`scripts/fetch_data.py` rebuilds the subset, orbital snapshot and catalogue metadata from attributed upstream sources. `scripts/fetch_satellite_catalogue.py` refreshes only object metadata. Documented mission roles live in `src/satellite-info.ts`, with a source link for each role. Library versions are locked in `package-lock.json`.

Application code is MIT licensed. Data and font retain their own licenses as described above.

## Terrain and elevation

The backend samples [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/) (Terrarium PNG), starting from zooms 12, 11, 9 and 8 with increasing distance. At high latitudes it reduces zoom as Mercator tiles cover less ground, keeping pixel sizes comparable to the equatorial profile while retaining all angular rays and distance samples. [Full data attribution](public/data/TERRAIN-ATTRIBUTION.md). It traces great-circle rays and computes the maximum geometric elevation angle per bearing. Tiles and profiles are cached in bounded memory; at most two profiles and six tile requests run concurrently, and callers share downloads of the same tile. Each profile has a 128-tile budget and a 40-second computation budget; the HTTP request waits at most 45 seconds including queueing. Limit failures return an explicit error without caching a partial skyline. Coverage is limited to 83°S–83°N; the chart clips negative terrain horizons at 0°. Narrow ridges, terrain within 75 m, and obstructions not represented in the elevation data can be missed.

Tile downloads are capped at 1 MiB, accept PNG only, and must declare 256×256 dimensions before pixel decoding. The shared download queue also has a 128-tile cap; shared downloads may finish after an individual caller times out. Address search and elevation each allow two running requests and eight distinct outstanding requests; excess work returns 503 promptly. Successful results are cached in 256-entry caches for five minutes and 24 hours respectively. These caches and limits apply per server process. Health checks run independently of these blocking upstream lookups.

Horizon calculations use ground height from the same terrain grid plus user-specified height above ground, avoiding offsets between elevation models. Ground elevation for Swiss address matches is queried from [swisstopo](https://docs.geo.admin.ch/access-data/get-point-height.html); manual-coordinate and browser-location lookups use Mapzen. Ground elevation used for sky coordinates remains editable.

`npm run test:api` verifies terrain geometry and tile decoding; `npm test` also covers horizon interpolation and local-time/DST behavior.

## Faint-star and satellite-pass implementation

`astra/deep_stars.py` validates and caches up to 32 Gaia cone results. At most two archive queries run concurrently, with eight pending requests. The browser debounces requests, reuses a padded cone while the view stays inside it, keeps eight field results, aborts stale requests and pins a selected Gaia star so its details remain available after panning. Gaia positions use their reference epoch (2016); HYG uses 2000.

`scripts/build_gaia_overview.py` generates the whole-sky extract as compact rows in a roughly 5.1 MB gzip file, loaded once when the magnitude slider passes 7.5 and cached by the browser. Spatial filtering excludes the opposite sky from the 10 Hz position calculations. At fields above 20°, fixed equal-area ICRS cells retain the brightest Gaia source per cell; each closer zoom level quarters the cell area. At 20° and below the available overview sample is retained without density thinning. HYG stars and the selected star keep their identities. Individual star hit targets and radii remain intact when canvas fills are batched by shade.

Pan and zoom update the camera immediately. Gaia coverage and density selection wait until the view has settled for 180 ms, so every trackpad movement does not rebuild the merged catalogue, proper-motion cache and stellar-neighbourhood diagram. Existing stars continue to move with the observing clock; finer coverage follows after the gesture. Wheel and pinch deltas apply to the latest queued camera state, including multiple events before a render.

Deeper cone radii are bounded at 32°/16°/8° for the G10/G12/G14 tiers, including Observer-view corners and request padding. Each response is still capped at 6,000 sources. Zooming into a truncated result requests a smaller cone so the cap does not prevent progressively fainter stars from loading. The broad overview is a responsive chart, not a claim that every G14 star across the hemisphere has been downloaded.

The Gaia endpoint preserves requested magnitude precision, including values just above 7.5, so valid boundary values do not turn into upstream-error responses through rounding.

Satellite paths are cached per satellite and observing site for the continuous pass containing the observing time. Horizon crossings are refined to roughly 10 milliseconds, with additional angular samples near overhead passes. Searches stop after two orbital periods or 48 hours; objects that do not cross the horizon in that interval have bounded partial tracks. Paths use the geometric horizon and remain clipped by terrain in Observer view.

The ordinary satellite layer includes the CelesTrak visual and Starlink groups by default, deduplicated by NORAD catalogue number. The bundled Starlink snapshot has 11,080 objects. Each group is refreshed independently by the scheduled job; a group that fails or reports no new data keeps its previous snapshot. Starlink craft are identified as communications satellites; unknown exact launch dates are left blank. Default visibility follows the same horizon, terrain, layer and orbital-epoch rules as other satellites, without a separate Starlink switch or a sunlight-only restriction.

An exact SGP4 calculation runs in a browser worker. Only a packed numeric frame crosses back to the UI; the main chart's stars, planets and satellite positions share that frame's observing time. Requests coalesce to the newest time if the worker is busy. An unsupported or failed worker falls back to calculation on the UI thread. The observing clock requests 10 updates per second; actual painting depends on device performance and catalogue load. No orbital interpolation is used. Unselected map satellites omit geographic altitude calculations; the selected sidebar and Earth track compute them in full.

`npm test` covers catalogue epoch handling, field coverage at RA wrap/poles, catalogue deduplication, magnitude-dependent request bounds and satellite pass endpoints. Python tests cover Gaia parsing, preserved identifiers, unknown distances, truncation and rejected unbounded queries in addition to terrain geometry.

Star proper-motion coordinates are cached per catalogue and observing minute; horizontal rotation uses the current 100 ms clock tick. Planet and satellite positions use that same current instant. Projection bases and the Sun vector are shared within each frame, and canvas buffers are resized only when their dimensions change. Tests compare cached star positions with independent Astronomy Engine transforms and check that earlier frames remain unchanged.

"""FastAPI application: the JSON API under /api, plus the built frontend when it is present."""
import asyncio
import html
import re
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import DATA, DIST, deep_stars, satellites, terrain
from .coalesce import Busy, Coalescer
from .upstream import HEADERS

OVERVIEW = DATA / 'gaia-overview.json.gz'
GZIP_MAGIC = b'\x1f\x8b'
SEARCH_URL = 'https://api3.geo.admin.ch/rest/services/ech/SearchServer'
TERRAIN_WAIT_SECONDS = 45
UPSTREAM_ERRORS = (requests.RequestException, ValueError, OSError, KeyError, TypeError)

terrain_work = Coalescer(workers=2, backlog=8)
star_work = Coalescer(workers=2, backlog=8)


def strip_tags(label: str) -> str:
    return html.unescape(re.sub('<[^>]*>', '', label))


def search_results(rows: list[dict]) -> list[dict]:
    return [{'name': strip_tags(row['attrs']['label']), 'lat': row['attrs']['lat'], 'lon': row['attrs']['lon'],
             'easting': row['attrs']['y'], 'northing': row['attrs']['x']} for row in rows]


def bundled_overview() -> Path:
    """The whole-sky Gaia extract, but only when it is real gzip data rather than a Git LFS pointer."""
    try:
        with OVERVIEW.open('rb') as file:
            if file.read(2) != GZIP_MAGIC:
                raise ValueError('not gzip')
    except (OSError, ValueError):
        raise HTTPException(503, 'The Gaia whole-sky layer is not bundled on this server.')
    return OVERVIEW


def create_app(static_dir: Path | None = DIST) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None)
    search_work = Coalescer(workers=2, backlog=8, cache_size=256, ttl=300)
    elevation_work = Coalescer(workers=2, backlog=8, cache_size=256, ttl=86400)

    @app.get('/api/health')
    async def health():
        return {'status': 'ok', 'hardware': 'simulation only'}

    @app.get('/api/satellites')
    async def satellite_feed():
        for feed in satellites.FEEDS:
            feed.schedule_refresh()
        return JSONResponse(satellites.combined(), headers={'Cache-Control': 'public, max-age=300'})

    @app.get('/api/horizon')
    async def horizon(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180),
                      height: float = Query(default=1.5, ge=0, le=500)):
        key = (round(lat, 5), round(lon, 5), round(height, 1))
        try:
            result = await asyncio.wait_for(terrain_work.run(key, lambda: terrain.horizon(*key)),
                                            timeout=TERRAIN_WAIT_SECONDS)
        except Busy:
            raise HTTPException(503, 'Terrain is busy. Try again shortly.')
        except TimeoutError:
            raise HTTPException(503, 'Terrain calculation exceeded its time limit. Try again shortly.')
        except terrain.TerrainUnavailable as error:
            raise HTTPException(503, str(error)) from error
        except ValueError as error:
            raise HTTPException(422, str(error)) from error
        except UPSTREAM_ERRORS:
            raise HTTPException(503, 'Could not load terrain data. Try again.')
        return JSONResponse(result, headers={'Cache-Control': 'private, max-age=86400'})

    @app.get('/api/elevation')
    async def elevation(lat: float = Query(ge=-85, le=85), lon: float = Query(ge=-180, le=180),
                  easting: float | None = Query(default=None, ge=2400000, le=2900000),
                  northing: float | None = Query(default=None, ge=1000000, le=1400000)):
        if (easting is None) != (northing is None):
            raise HTTPException(422, 'Supply both easting and northing for an address elevation.')
        key = (round(lat, 5), round(lon, 5),
               round(easting, 1) if easting is not None else None,
               round(northing, 1) if northing is not None else None)
        try:
            return await elevation_work.run(key, lambda: terrain.elevation(*key))
        except Busy:
            raise HTTPException(503, 'Elevation lookup is busy. Try again shortly or enter it manually.')
        except UPSTREAM_ERRORS:
            raise HTTPException(503, 'Elevation lookup is unavailable. You can enter it manually.')

    @app.get('/api/locations/search')
    async def search_locations(q: str = Query(min_length=3, max_length=160)):
        query = ' '.join(q.split()).casefold()
        if len(query) < 3:
            raise HTTPException(422, 'Enter at least three characters to search.')
        def lookup():
            response = requests.get(SEARCH_URL, headers=HEADERS, timeout=12, params={
                'searchText': query, 'type': 'locations', 'origins': 'address,gazetteer', 'sr': 2056, 'limit': 6})
            response.raise_for_status()
            return {'results': search_results(response.json()['results'])}
        try:
            return await search_work.run(query, lookup)
        except Busy:
            raise HTTPException(503, 'Address search is busy. Try again shortly.')
        except (requests.RequestException, ValueError, KeyError, TypeError):
            raise HTTPException(503, 'Address search is unavailable. Use coordinates or your browser location.')

    @app.get('/api/stars/overview')
    async def star_overview():
        return FileResponse(bundled_overview(), media_type='application/json',
                            headers={'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=86400'})

    @app.get('/api/stars/deep')
    async def faint_stars(ra: float = Query(ge=0, le=360), dec: float = Query(ge=-90, le=90),
                          radius: float = Query(ge=0.1, le=32), magnitude: float = Query(gt=7.5, le=14)):
        key = (round(ra, 5), round(dec, 5), round(radius, 3), magnitude)
        if key[2] > deep_stars.radius_limit(magnitude):
            raise HTTPException(422, 'Field too wide for this magnitude. Zoom closer.')
        try:
            result = await star_work.run(key, lambda: deep_stars.cone(*key))
        except Busy:
            raise HTTPException(503, 'Faint-star catalogue is busy. Try again shortly.')
        except UPSTREAM_ERRORS:
            raise HTTPException(503, 'Could not load Gaia stars. Try again; the bright-star map remains available.')
        return JSONResponse(result, headers={'Cache-Control': 'public, max-age=86400'})

    if static_dir is not None and static_dir.is_dir():
        app.mount('/', StaticFiles(directory=static_dir, html=True), name='frontend')
    return app


app = create_app()

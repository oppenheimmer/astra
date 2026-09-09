"""Cached terrain rays from public Mapzen Terrarium elevation tiles.

North = 0°, clockwise. Geometric skyline, including Earth curvature; no
buildings, vegetation masks, atmospheric refraction, or artificial peaks.
"""
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from io import BytesIO
import math

import numpy as np
from PIL import Image
import requests

EARTH = 6_371_008.8
TILES = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium'
TILE_WORKERS = ThreadPoolExecutor(max_workers=6)
from .upstream import HEADERS


def decode_tile(content):
    with Image.open(BytesIO(content)) as image:
        rgb = np.asarray(image.convert('RGB'), dtype=np.float32)
    if rgb.shape != (256, 256, 3):
        raise ValueError('Invalid terrain tile')
    return rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768


@lru_cache(maxsize=256)
def tile(z, x, y):
    response = requests.get(f'{TILES}/{z}/{x}/{y}.png', headers=HEADERS, timeout=(5, 15))
    response.raise_for_status()
    return decode_tile(response.content)


def pixels(lat, lon, z):
    """Web Mercator pixel centres, including longitude wrap."""
    scale = 256 * 2**z
    x = (np.asarray(lon) + 180) / 360 * scale - 0.5
    y = (1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * scale - 0.5
    return x, y


def elevations(lat, lon, z):
    """Bilinear samples across tile seams. Fetch only tiles touched by rays."""
    lat, lon = np.broadcast_arrays(lat, lon)
    if np.any(np.abs(lat) > 85):
        raise ValueError('Terrain is unavailable this close to the poles.')
    x, y = pixels(lat.ravel(), lon.ravel(), z)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    dx, dy = x - x0, y - y0
    grids = [(x0, y0), (x0 + 1, y0), (x0, y0 + 1), (x0 + 1, y0 + 1)]
    grids = [(xx % (256 * 2**z), np.clip(yy, 0, 256 * 2**z - 1)) for xx, yy in grids]
    keys = set()
    for xx, yy in grids:
        keys.update((z, int(a), int(b)) for a, b in np.unique(np.column_stack((xx // 256, yy // 256)), axis=0))
    keys = sorted(keys)
    loaded = dict(zip(keys, TILE_WORKERS.map(lambda k: tile(*k), keys)))
    values = []
    for xx, yy in grids:
        sampled = np.empty(len(xx), dtype=np.float32)
        # Group indices once, rather than testing the whole sample grid per tile.
        codes = (xx // 256) * 2**z + yy // 256
        order = np.argsort(codes)
        sorted_codes = codes[order]
        cuts = np.r_[0, np.flatnonzero(np.diff(sorted_codes)) + 1, len(order)]
        for start, end in zip(cuts[:-1], cuts[1:]):
            idx = order[start:end]
            tx, ty = int(xx[idx[0]] // 256), int(yy[idx[0]] // 256)
            sampled[idx] = loaded[(z, tx, ty)][yy[idx] % 256, xx[idx] % 256]
        values.append(sampled)
    result = (values[0] * (1-dx) * (1-dy) + values[1] * dx * (1-dy)
              + values[2] * (1-dx) * dy + values[3] * dx * dy)
    if not np.isfinite(result).all() or np.any(result < -12000):
        raise ValueError('Missing terrain heights')
    return result.reshape(lat.shape)


def destinations(lat, lon, azimuths, distances):
    """Great-circle rays, independent of map projection and date line."""
    phi, lam = np.radians(lat), np.radians(lon)
    a = np.radians(np.asarray(azimuths))[:, None]
    d = np.asarray(distances)[None, :] / EARTH
    phi2 = np.arcsin(np.sin(phi) * np.cos(d) + np.cos(phi) * np.sin(d) * np.cos(a))
    lam2 = lam + np.arctan2(np.sin(a) * np.sin(d) * np.cos(phi), np.cos(d) - np.sin(phi) * np.sin(phi2))
    return np.degrees(phi2), (np.degrees(lam2) + 180) % 360 - 180


def terrain_angles(distances, heights, observer_elevation):
    d = np.asarray(distances) / EARTH
    return np.degrees(np.arctan2((EARTH + heights) * np.cos(d) - (EARTH + observer_elevation),
                                (EARTH + heights) * np.sin(d)))


@lru_cache(maxsize=128)
def horizon(lat, lon, height=1.5):
    if abs(lat) > 83:
        raise ValueError('Mountain outlines are available between 83°S and 83°N.')
    ground = float(elevations(np.array([lat]), np.array([lon]), 12)[0])
    azimuths = np.arange(1440) / 4
    skyline = np.zeros(len(azimuths))
    # Nearby slopes need finer samples than distant ranges. All bands overlap
    # at their boundary. Zero is the personal chart's lower altitude limit.
    for start, stop, step, zoom in [(75, 4000, 40, 12), (4000, 25000, 150, 11),
                                     (25000, 100000, 500, 9), (100000, 200000, 1000, 8)]:
        distances = np.arange(start, stop + step, step)
        lats, lons = destinations(lat, lon, azimuths, distances)
        heights = elevations(lats, lons, zoom)
        angles = terrain_angles(distances, heights, ground + height)
        skyline = np.maximum(skyline, np.max(angles, axis=1))
    return {'lat': lat, 'lon': lon, 'heightAboveGround': height,
            'groundElevation': round(ground, 1), 'step': 0.25,
            'altitudes': np.round(skyline, 3).tolist(), 'rangeKm': 200,
            'source': 'Mapzen Terrain Tiles', 'approximate': True}


def elevation(lat, lon, easting=None, northing=None):
    if easting is not None and northing is not None:
        response = requests.get('https://api3.geo.admin.ch/rest/services/height',
            params={'easting': easting, 'northing': northing, 'sr': 2056}, headers=HEADERS, timeout=12)
        response.raise_for_status()
        result = float(response.json()['height'])
        if not math.isfinite(result):
            raise ValueError('No elevation at this address')
        return {'elevation': round(result), 'source': 'swisstopo'}
    result = float(elevations(np.array([lat]), np.array([lon]), 12)[0])
    return {'elevation': round(result), 'source': 'Mapzen Terrain Tiles'}

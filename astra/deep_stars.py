"""Bounded Gaia DR3 cone searches for the zoomed sky chart."""
import csv
import io
import math
from functools import lru_cache

import requests

from .upstream import HEADERS

ENDPOINT = 'https://gea.esac.esa.int/tap-server/tap/sync'
CONE_ENDPOINTS = ('https://gaia.ari.uni-heidelberg.de/tap/sync', ENDPOINT)
MAX_STARS = 6000


def radius_limit(magnitude):
    """Widest cone, in degrees, that the archives answer quickly at this depth."""
    return 32 if magnitude <= 10 else 16 if magnitude <= 12 else 8


def number(row, key):
    try:
        value = float(row[key])
        return value if math.isfinite(value) else None
    except (KeyError, TypeError, ValueError):
        return None


def parse_catalogue(text, limit=None):
    limit = MAX_STARS if limit is None else limit
    reader = csv.DictReader(io.StringIO(text))
    required = {'source_id', 'ra', 'dec', 'ref_epoch', 'phot_g_mean_mag'}
    if not required.issubset(reader.fieldnames or []):
        raise ValueError('Invalid Gaia catalogue response')
    stars = []
    seen = set()
    count = 0
    for row in reader:
        count += 1
        source_id = row['source_id']  # 64-bit IDs must remain strings in JSON.
        ra, dec, mag, epoch = (number(row, k) for k in ('ra', 'dec', 'phot_g_mean_mag', 'ref_epoch'))
        if not source_id.isdigit() or None in (ra, dec, mag, epoch):
            raise ValueError('Invalid Gaia star')
        if source_id in seen:
            continue  # Cross-match tables can contain multiple associations.
        seen.add(source_id)
        parallax, snr = number(row, 'parallax'), number(row, 'parallax_over_error')
        # An inverse parallax is only a rough distance, even at high S/N.
        pc = 1000 / parallax if parallax and parallax > 0 and snr and snr >= 10 else None
        a, d = math.radians(ra), math.radians(dec)
        stars.append({
            'id': 'gaia' + source_id, 'gaiaId': source_id, 'hip': row.get('hip_id') or '',
            'name': 'Gaia DR3 ' + source_id, 'named': False, 'source': 'Gaia DR3', 'band': 'G',
            'ra': ra / 15, 'dec': dec, 'epoch': epoch, 'mag': mag,
            'dist': round(pc * 3.2615638, 2) if pc else None,
            'spec': '', 'con': '', 'lum': None, 'ci': None,
            'pmra': number(row, 'pmra'), 'pmdec': number(row, 'pmdec'),
            'x': pc * math.cos(d) * math.cos(a) if pc else 0,
            'y': pc * math.cos(d) * math.sin(a) if pc else 0,
            'z': pc * math.sin(d) if pc else 0,
        })
    stars.sort(key=lambda star: (star['mag'], star['id']))
    return stars[:limit], count > limit


@lru_cache(maxsize=32)
def cone(ra, dec, radius, magnitude):
    if not (all(math.isfinite(v) for v in (ra, dec, radius, magnitude)) and
            0 <= ra <= 360 and -90 <= dec <= 90 and 0.1 <= radius <= 32 and 7.5 < magnitude <= 14):
        raise ValueError('Invalid faint-star field')
    if radius > radius_limit(magnitude):
        raise ValueError('Field too wide for this magnitude. Zoom closer.')
    query = f"""SELECT TOP {MAX_STARS + 1}
        g.source_id,g.ra,g.dec,g.ref_epoch,g.phot_g_mean_mag,g.parallax,
        g.parallax_over_error,g.pmra,g.pmdec,x.original_ext_source_id AS hip_id
        FROM gaiadr3.gaia_source AS g
        LEFT OUTER JOIN gaiadr3.hipparcos2_best_neighbour AS x ON g.source_id=x.source_id
        WHERE 1=CONTAINS(POINT('ICRS',g.ra,g.dec),CIRCLE('ICRS',{ra:.5f},{dec:.5f},{radius:.3f}))
        AND g.phot_g_mean_mag > 7.5 AND g.phot_g_mean_mag <= {magnitude:.1f}
        ORDER BY phot_g_mean_mag"""
    # ARI is an official Gaia partner. Its cone queries handle the wider fields
    # efficiently; retain ESA as a bounded fallback. Both preserve HIP matches.
    last_error = None
    for i, endpoint in enumerate(CONE_ENDPOINTS):
        try:
            with requests.get(endpoint, params={'REQUEST': 'doQuery', 'LANG': 'ADQL', 'FORMAT': 'csv', 'QUERY': query},
                              headers=HEADERS, timeout=(4, 20 if i == 0 else 12), stream=True) as response:
                response.raise_for_status()
                content = bytearray()
                for chunk in response.iter_content(65536):
                    content.extend(chunk)
                    if len(content) > 4_000_000:
                        raise ValueError('Gaia response exceeded the field limit')
            stars, truncated = parse_catalogue(content.decode('utf-8'))
            return {'stars': stars, 'truncated': truncated, 'source': 'Gaia DR3', 'band': 'G', 'archive': endpoint,
                    'ra': ra, 'dec': dec, 'radius': radius, 'magnitude': magnitude}
        except (requests.RequestException, ValueError) as error:
            last_error = error
    raise last_error

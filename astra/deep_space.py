"""Spacecraft beyond Earth orbit, from JPL Horizons.

SGP4 elements describe Earth orbits only. Spacecraft at the Sun-Earth Lagrange
points and on interplanetary trajectories need an ephemeris, which JPL Horizons
publishes for each mission it supports. A refresh samples each craft's
geocentric position in the ICRF equatorial frame every three hours, from three
days before the run to ten days after it; the browser interpolates between
samples and hides a craft outside that window rather than guessing.
"""
from datetime import datetime, timedelta, timezone
import math
from typing import Any

import requests

from .upstream import HEADERS

SOURCE = 'JPL Horizons'
API = 'https://ssd.jpl.nasa.gov/api/horizons.api'
STEP_HOURS = 3
BEFORE_DAYS = 3
AFTER_DAYS = 10
SAMPLES = (BEFORE_DAYS + AFTER_DAYS) * 24 // STEP_HOURS + 1
REGIONS = ('L1', 'L2', '')
# Horizons ID, display name, and the Sun-Earth Lagrange point it works at ('' when it travels).
CRAFT = (
    ('-170', 'James Webb', 'L2'),
    ('-211', 'Nancy Grace Roman', 'L2'),
    ('-680', 'Euclid', 'L2'),
    ('-21', 'SOHO', 'L1'),
    ('-92', 'ACE', 'L1'),
    ('-8', 'Wind', 'L1'),
    ('-78', 'DSCOVR', 'L1'),
    ('-43', 'IMAP', 'L1'),
    ('-231', 'SWFO-L1', 'L1'),
    ('-171', 'Carruthers', 'L1'),
    ('-139479', 'Gaia', ''),
    ('-98', 'New Horizons', ''),
    ('-31', 'Voyager 1', ''),
    ('-32', 'Voyager 2', ''),
    ('-23', 'Pioneer 10', ''),
    ('-24', 'Pioneer 11', ''),
    ('-96', 'Parker Solar Probe', ''),
    ('-61', 'Juno', ''),
    ('-159', 'Europa Clipper', ''),
    ('-28', 'JUICE', ''),
    ('-255', 'Psyche', ''),
    ('-49', 'Lucy', ''),
    ('-64', 'OSIRIS-APEX', ''),
    ('-91', 'Hera', ''),
    ('-121', 'BepiColombo', ''),
    ('-144', 'Solar Orbiter', ''),
    ('-37', 'Hayabusa2', ''),
)


def window(now: datetime) -> tuple[datetime, datetime]:
    """Whole hours, so successive runs sample the same instants."""
    start = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(days=BEFORE_DAYS)
    return start, start + timedelta(hours=STEP_HOURS * (SAMPLES - 1))


def parse_vectors(result: str) -> list[int]:
    """X, Y, Z per row of a CSV vector table, rounded to whole kilometres."""
    try:
        block = result.split('$$SOE', 1)[1].split('$$EOE', 1)[0]
    except IndexError as error:
        # Horizons explains a missing ephemeris in prose, outside any table.
        raise ValueError(result.strip().splitlines()[-1][:200] if result.strip() else 'No ephemeris') from error
    positions = []
    for line in block.strip().splitlines():
        fields = [f.strip() for f in line.split(',')]
        positions.extend(round(float(v)) for v in fields[2:5])
    if len(positions) != SAMPLES * 3 or not all(math.isfinite(v) for v in positions):
        raise ValueError('Incomplete ephemeris')
    return positions


def vectors(command: str, start: datetime, stop: datetime, timeout: float = 60) -> list[int]:
    quoted = lambda value: f"'{value}'"  # noqa: E731 - Horizons wants every value quoted
    params = {
        'format': 'json', 'COMMAND': quoted(command), 'OBJ_DATA': quoted('NO'), 'MAKE_EPHEM': quoted('YES'),
        'EPHEM_TYPE': quoted('VECTORS'), 'CENTER': quoted('500@399'), 'REF_PLANE': quoted('FRAME'),
        'REF_SYSTEM': quoted('ICRF'), 'VEC_TABLE': quoted('1'), 'CSV_FORMAT': quoted('YES'),
        'OUT_UNITS': quoted('KM-S'), 'TIME_TYPE': quoted('UT'), 'STEP_SIZE': quoted(f'{STEP_HOURS} h'),
        'START_TIME': quoted(f'{start:%Y-%m-%d %H:%M}'), 'STOP_TIME': quoted(f'{stop:%Y-%m-%d %H:%M}'),
    }
    response = requests.get(API, params=params, headers=HEADERS, timeout=timeout)
    response.raise_for_status()
    return parse_vectors(response.json()['result'])


def fetch(now: datetime | None = None) -> dict:
    """Every listed craft Horizons can place over the whole window; one missing craft never costs the others."""
    start, stop = window(now or datetime.now(timezone.utc))
    craft = []
    for command, name, region in CRAFT:
        try:
            craft.append({'id': command, 'name': name, 'region': region, 'positions': vectors(command, start, stop)})
        except (requests.RequestException, ValueError, KeyError, TypeError) as error:
            print(f'  deep-space: {name} unavailable ({type(error).__name__}: {str(error)[:80]})')
    if not craft:
        raise ValueError('No deep-space ephemeris available')
    return valid({'start': start.isoformat().replace('+00:00', 'Z'), 'step': STEP_HOURS * 3600000,
                  'count': SAMPLES, 'craft': craft})


def valid(payload: Any) -> dict:
    """Normalize a payload, or raise ValueError."""
    if not isinstance(payload, dict) or not isinstance(payload.get('craft'), list) or not payload['craft']:
        raise ValueError('Invalid deep-space payload')
    count, step = payload.get('count'), payload.get('step')
    if type(count) is not int or count < 2 or type(step) is not int or step <= 0:
        raise ValueError('Invalid deep-space sampling')
    datetime.fromisoformat(str(payload.get('start')).replace('Z', '+00:00'))
    for craft in payload['craft']:
        if not isinstance(craft, dict):
            raise ValueError('Invalid deep-space craft')
        positions = craft.get('positions')
        if (not isinstance(craft.get('id'), str) or not isinstance(craft.get('name'), str) or not craft['name']
                or craft.get('region') not in REGIONS or not isinstance(positions, list) or len(positions) != count * 3
                or not all(type(v) in (int, float) and math.isfinite(v) for v in positions)):
            raise ValueError('Invalid deep-space craft')
    return payload

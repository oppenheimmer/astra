"""SatNOGS DB: orbits beyond CelesTrak's active group, and radio details for every satellite it tracks.

SatNOGS DB (https://db.satnogs.org) is a community catalogue of satellites and
their radio transmitters. Its data are distributed under CC BY-SA 4.0. Three
public endpoints are combined:

- ``/api/tle/``: current two-line elements, mostly republished from
  Space-Track.org, some maintained by the SatNOGS team for new deployments.
- ``/api/satellites/``: status, operator, countries and website.
- ``/api/transmitters/``: downlink frequencies and modes, each marked alive or not.

TLEs are converted to the same OMM fields CelesTrak publishes, so the browser
handles every element set alike. The refresh merges them under CelesTrak's,
which win any NORAD number both sources list.
"""
from datetime import datetime, timedelta, timezone
import re
from typing import Any

import requests

from .elements import MAX_ELEMENTS, norad_id, valid_elements
from .upstream import HEADERS

SOURCE = 'SatNOGS DB'
API = 'https://db.satnogs.org/api'
SATELLITE_PAGE = 'https://db.satnogs.org/satellite/'
# Older elements are of no use to the chart, which stops drawing three days from
# an epoch; a fortnight leaves room to look back without publishing dead weight.
MAX_TLE_AGE_DAYS = 14
# The ISS alone lists over forty transmitters. A few downlinks say what to
# listen for; the full list is one link away.
MAX_DOWNLINKS = 3
TEXT_LIMIT = 80
# CelesTrak's naming for objects that are not spacecraft.
NOT_A_PAYLOAD = re.compile(r'\b(R/B|DEB|AKM|PKM)\b')
ALPHA5 = 'ABCDEFGHJKLMNPQRSTUVWXYZ'  # I and O are skipped to avoid confusion with 1 and 0.


def checksum(line: str) -> bool:
    """TLE modulo-10 checksum: digits count at face value, each minus sign as one."""
    total = sum(int(c) if c.isdigit() else c == '-' for c in line[:68])
    return line[68:69].isdigit() and total % 10 == int(line[68])


def catalogue_number(field: str) -> int:
    """The five-character catalogue field, including Alpha-5 numbers above 99999."""
    field = field.strip()
    if len(field) == 5 and field[0] in ALPHA5 and field[1:].isdigit():
        return (ALPHA5.index(field[0]) + 10) * 10000 + int(field[1:])
    return norad_id(field)


def implied_decimal(field: str) -> float:
    """TLE exponent notation: ' 12345-4' is 0.12345e-4, '-11606-4' is -0.11606e-4."""
    field = field.strip()
    match = re.fullmatch(r'([+-]?)(\d{1,5})([+-]\d)', field)
    if not match:
        raise ValueError(f'Invalid TLE exponent field {field!r}')
    sign, digits, exponent = match.groups()
    return float(f'{sign}0.{digits}e{exponent}')


def tle_epoch(year: str, day: str) -> str:
    """Two-digit year (57-99 are the 1900s) and fractional day of year, as an ISO UTC time."""
    full = int(year) + (1900 if int(year) >= 57 else 2000)
    moment = datetime(full, 1, 1, tzinfo=timezone.utc) + timedelta(days=float(day) - 1)
    return moment.isoformat(timespec='microseconds').replace('+00:00', 'Z')


def international_id(field: str) -> str:
    """'98067A  ' becomes '1998-067A'; blank for analyst objects with no designator."""
    field = field.strip()
    if not re.fullmatch(r'\d{5}[A-Z]{1,3}', field):
        return ''
    year = int(field[:2])
    return f"{year + (1900 if year >= 57 else 2000)}-{field[2:5]}{field[5:]}"


def tle_to_omm(name: str, line1: str, line2: str) -> dict:
    """One element set in CelesTrak's OMM JSON fields, after the format and checksum checks."""
    line1, line2 = line1.rstrip(), line2.rstrip()
    if (len(line1) != 69 or len(line2) != 69 or line1[0] != '1' or line2[0] != '2'
            or not checksum(line1) or not checksum(line2) or line1[2:7] != line2[2:7]):
        raise ValueError('Invalid TLE')
    # Line zero is the name, optionally prefixed '0 '; an empty name is not a satellite.
    name = re.sub(r'^0 ', '', name.lstrip()).strip()
    if not name:
        raise ValueError('Invalid satellite name')
    return {
        'OBJECT_NAME': name,
        'OBJECT_ID': international_id(line1[9:17]),
        'EPOCH': tle_epoch(line1[18:20], line1[20:32]),
        'MEAN_MOTION': float(line2[52:63]),
        'ECCENTRICITY': float('0.' + line2[26:33].strip()),
        'INCLINATION': float(line2[8:16]),
        'RA_OF_ASC_NODE': float(line2[17:25]),
        'ARG_OF_PERICENTER': float(line2[34:42]),
        'MEAN_ANOMALY': float(line2[43:51]),
        'EPHEMERIS_TYPE': 0,
        'CLASSIFICATION_TYPE': line1[7],
        'NORAD_CAT_ID': catalogue_number(line1[2:7]),
        'ELEMENT_SET_NO': int(line1[64:68]),
        'REV_AT_EPOCH': int(line2[63:68]),
        'BSTAR': implied_decimal(line1[53:61]),
        'MEAN_MOTION_DOT': float(line1[33:43]),
        'MEAN_MOTION_DDOT': implied_decimal(line1[44:52]),
    }


def text(value: Any, limit: int = TEXT_LIMIT) -> str:
    """A short display string; SatNOGS writes an unknown operator as the word 'None'."""
    if not isinstance(value, str) or value.strip() in ('', 'None'):
        return ''
    return ' '.join(value.split())[:limit]


def downlinks(transmitters: list[dict]) -> list[dict]:
    """Amateur-service downlinks first, then the rest by frequency, without repeats."""
    ordered = sorted(transmitters, key=lambda t: (t.get('service') != 'Amateur', t['downlink_low']))
    seen, result = set(), []
    for t in ordered:
        key = (t['downlink_low'], text(t.get('mode')))
        if key in seen:
            continue
        seen.add(key)
        result.append({'description': text(t.get('description')), 'frequency': t['downlink_low'],
                       'mode': text(t.get('mode'), 24)})
        if len(result) == MAX_DOWNLINKS:
            break
    return result


def build(tles: Any, satellites: Any, transmitters: Any, now: datetime | None = None) -> dict:
    """Combine the three endpoints into publishable elements and per-NORAD metadata.

    SatNOGS gives some objects a temporary 99xxx number before, or instead of,
    following the official one; the TLE line carries the number of the element
    set itself, so that is the key. Where two records share it, the record
    whose own number matches is preferred. Re-entered and future satellites,
    rocket bodies and debris, invalid TLEs and old epochs are left out.
    """
    if not all(isinstance(x, list) for x in (tles, satellites, transmitters)) or not tles:
        raise ValueError('Invalid SatNOGS response')
    now = now or datetime.now(timezone.utc)
    records = {s['sat_id']: s for s in satellites if isinstance(s, dict) and isinstance(s.get('sat_id'), str)}
    live: dict[str, list[dict]] = {}
    for t in transmitters:
        if (isinstance(t, dict) and t.get('alive') is True and t.get('status') == 'active'
                and type(t.get('downlink_low')) is int and t['downlink_low'] > 0):
            live.setdefault(t.get('sat_id'), []).append(t)

    chosen: dict[int, tuple[dict, dict, dict]] = {}
    for item in tles:
        try:
            record = records[item['sat_id']]
            if record.get('status') != 'in orbit':
                continue
            # One at a time: the shared check rejects a whole list for a single bad entry.
            element = valid_elements([tle_to_omm(item['tle0'], item['tle1'], item['tle2'])])[0]
        except (KeyError, TypeError, ValueError):
            continue
        number = element['NORAD_CAT_ID']
        epoch = datetime.fromisoformat(element['EPOCH'].replace('Z', '+00:00'))
        if NOT_A_PAYLOAD.search(element['OBJECT_NAME']) or now - epoch > timedelta(days=MAX_TLE_AGE_DAYS):
            continue
        previous = chosen.get(number)
        if previous and (previous[1].get('norad_cat_id') == number or record.get('norad_cat_id') != number):
            continue
        chosen[number] = (element, record, item)

    canonical = {r['norad_cat_id']: r for r in records.values()
                 if r.get('status') == 'in orbit' and type(r.get('norad_cat_id')) is int}
    objects: dict[str, dict] = {}
    for number, (element, record, item) in chosen.items():
        # A temporary record may hold the orbit while the official one holds the radio details.
        owner = canonical.get(number, record)
        radios = live.get(owner['sat_id']) or live.get(record['sat_id'], [])
        objects[str(number)] = metadata(owner, radios, text(item.get('tle_source')) or SOURCE)
    # Radio details also belong to satellites whose orbit comes from CelesTrak.
    for record in records.values():
        number = record.get('norad_cat_id')
        if (record.get('status') == 'in orbit' and type(number) is int and 0 < number < 90000
                and str(number) not in objects and record['sat_id'] in live):
            objects[str(number)] = metadata(record, live[record['sat_id']], '')
    elements = [e for e, _, _ in chosen.values()]
    if len(objects) > MAX_ELEMENTS:
        raise ValueError('Too many SatNOGS objects')
    return {'elements': elements, 'objects': objects}


def metadata(record: dict, transmitters: list[dict], orbit_source: str) -> dict:
    return valid_entry({
        'id': record['sat_id'],
        'name': text(record.get('name')),
        'status': text(record.get('status'), 24),
        'operator': text(record.get('operator')),
        'countries': text(record.get('countries')),
        'website': text(record.get('website'), 200) if re.match(r'https?://', str(record.get('website', ''))) else '',
        'launched': text(record.get('launched'), 10),
        'transmitters': len(transmitters),
        'downlinks': downlinks(transmitters),
        # Where a SatNOGS orbit came from; blank when CelesTrak supplies the orbit.
        'orbitSource': orbit_source,
    })


def valid_entry(entry: Any) -> dict:
    """Normalize one metadata entry, or raise ValueError."""
    if not isinstance(entry, dict):
        raise ValueError('Invalid SatNOGS metadata')
    strings = ('id', 'name', 'status', 'operator', 'countries', 'website', 'launched', 'orbitSource')
    result = {key: entry.get(key, '') for key in strings}
    if (any(not isinstance(value, str) for value in result.values())
            or not re.fullmatch(r'[A-Z0-9-]{4,40}', result['id'])
            or (result['website'] and not re.match(r'https?://', result['website']))):
        raise ValueError('Invalid SatNOGS metadata')
    count, links = entry.get('transmitters', 0), entry.get('downlinks', [])
    if type(count) is not int or count < 0 or not isinstance(links, list) or len(links) > MAX_DOWNLINKS:
        raise ValueError('Invalid SatNOGS transmitters')
    result['transmitters'] = count
    result['downlinks'] = []
    for link in links:
        if (not isinstance(link, dict) or type(link.get('frequency')) is not int or link['frequency'] <= 0
                or not isinstance(link.get('description', ''), str) or not isinstance(link.get('mode', ''), str)):
            raise ValueError('Invalid SatNOGS downlink')
        result['downlinks'].append({'description': link.get('description', ''), 'frequency': link['frequency'],
                                    'mode': link.get('mode', '')})
    return result


def valid_objects(objects: Any) -> dict:
    if not isinstance(objects, dict) or len(objects) > MAX_ELEMENTS:
        raise ValueError('Invalid SatNOGS metadata')
    return {str(norad_id(key)): valid_entry(value) for key, value in objects.items()}


def fetch(timeout: float = 120) -> dict:
    """Download the three endpoints and combine them. Any failure leaves the previous copy in place."""
    def get(path: str):
        response = requests.get(f'{API}/{path}/', params={'format': 'json'}, headers=HEADERS, timeout=timeout)
        response.raise_for_status()
        return response.json()
    return build(get('tle'), get('satellites'), get('transmitters'))

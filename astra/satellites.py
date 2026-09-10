"""CelesTrak orbital elements and SATCAT metadata, served from bundled snapshots."""
from datetime import datetime, timezone
import math
import re
from typing import Any

import requests

from . import snapshot
from .feeds import Feed, NotModified
from .upstream import HEADERS

ELEMENTS_URL = 'https://celestrak.org/NORAD/elements/gp.php'
SATCAT_URL = 'https://celestrak.org/satcat/records.php'
ELEMENT_SECONDS = 7200
CATALOGUE_SECONDS = 86400
MAX_ELEMENTS = 50000
EPOCH_FORMAT = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\Z')


def norad_id(value: Any) -> int:
    """Normalize JSON integer/string IDs without accepting floats, booleans or containers."""
    if isinstance(value, str) and value.isascii() and value.isdigit():
        value = int(value)
    if type(value) is not int or not 0 < value <= 9007199254740991:
        raise ValueError('Invalid NORAD catalogue number')
    return value


def orbital_number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError('Invalid orbital number')
    number = float(value)
    if not math.isfinite(number):
        raise ValueError('Invalid orbital number')
    return number


def valid_elements(items: Any) -> list[dict]:
    if not isinstance(items, list) or not items or len(items) > MAX_ELEMENTS:
        raise ValueError('Invalid orbital-data response')
    normalized = []
    for item in items:
        try:
            if not isinstance(item, dict):
                raise ValueError('Invalid orbital element')
            element = {**item, 'NORAD_CAT_ID': norad_id(item['NORAD_CAT_ID'])}
            epoch = item['EPOCH']
            if not isinstance(epoch, str) or not EPOCH_FORMAT.fullmatch(epoch):
                raise ValueError('Invalid orbital epoch')
            parsed_epoch = datetime.fromisoformat(epoch)  # Also reject impossible calendar dates.
            if parsed_epoch.tzinfo is None:
                parsed_epoch = parsed_epoch.replace(tzinfo=timezone.utc)
            element['EPOCH'] = parsed_epoch.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
            if not isinstance(item.get('OBJECT_NAME'), str) or not item['OBJECT_NAME'].strip():
                raise ValueError('Invalid satellite name')
            for key in ('OBJECT_ID', 'CLASSIFICATION_TYPE'):
                if key in item and not isinstance(item[key], str):
                    raise ValueError('Invalid satellite metadata')
            element['OBJECT_ID'] = item.get('OBJECT_ID', '')
            element['ELEMENT_SET_NO'] = orbital_number(item.get('ELEMENT_SET_NO', 0))
            if not (0 <= element['ELEMENT_SET_NO'] <= 9007199254740991 and element['ELEMENT_SET_NO'].is_integer()):
                raise ValueError('Invalid satellite element-set number')
            element['ELEMENT_SET_NO'] = int(element['ELEMENT_SET_NO'])
            for key in ('MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE',
                        'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT'):
                element[key] = orbital_number(item[key])
            if not (0 < element['MEAN_MOTION'] <= 20 and 0 <= element['ECCENTRICITY'] < 1 and
                    0 <= element['INCLINATION'] <= 180 and
                    all(0 <= element[key] < 360 for key in ('RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY'))):
                raise ValueError('Orbital number outside its physical range')
        except (KeyError, TypeError, OverflowError) as error:
            raise ValueError('Invalid orbital element') from error
        normalized.append(element)
    return normalized


def fetch_elements(group: str, timeout: float) -> dict:
    response = requests.get(ELEMENTS_URL, params={'GROUP': group, 'FORMAT': 'JSON'},
                            headers=HEADERS, timeout=timeout)
    if response.status_code == 403:
        raise NotModified(response.text.strip()[:200])
    response.raise_for_status()
    return {'elements': valid_elements(response.json())}


def catalogue_entry(record: dict) -> dict:
    return catalogue_metadata({'objectType': record.get('OBJECT_TYPE', 'UNK'), 'owner': record.get('OWNER', ''),
                               'launchDate': record.get('LAUNCH_DATE', ''), 'internationalId': record.get('OBJECT_ID', '')})


def catalogue_metadata(record: dict) -> dict:
    entry = {key: record.get(key, 'UNK' if key == 'objectType' else '')
             for key in ('objectType', 'owner', 'launchDate', 'internationalId')}
    if any(not isinstance(value, str) for value in entry.values()):
        raise ValueError('Invalid satellite catalogue metadata')
    if entry['objectType'] not in ('PAY', 'R/B', 'DEB', 'UNK'):
        entry['objectType'] = 'UNK'
    return entry


def valid_catalogue(objects: Any) -> dict:
    if not isinstance(objects, dict) or len(objects) > MAX_ELEMENTS:
        raise ValueError('Invalid satellite catalogue')
    normalized = {}
    for key, value in objects.items():
        if not isinstance(value, dict):
            raise ValueError('Invalid satellite catalogue metadata')
        normalized[str(norad_id(key))] = catalogue_metadata(value)
    return normalized


def fetch_catalogue() -> dict:
    response = requests.get(SATCAT_URL, params={'GROUP': 'visual', 'FORMAT': 'JSON'},
                            headers=HEADERS, timeout=20)
    response.raise_for_status()
    records = response.json()
    if not isinstance(records, list) or not records or len(records) > MAX_ELEMENTS:
        raise ValueError('Invalid satellite catalogue')
    return {'objects': {str(norad_id(r['NORAD_CAT_ID'])): catalogue_entry(r) for r in records}}


visual = Feed(snapshot('satellites.json'), lambda: fetch_elements('visual', 20),
              ELEMENT_SECONDS, 'CelesTrak visual group')
starlink = Feed(snapshot('starlink.json'), lambda: fetch_elements('starlink', 30),
                ELEMENT_SECONDS, 'CelesTrak Starlink group')
catalogue = Feed(snapshot('satellite-catalogue.json'), lambda: fetch_catalogue(),
                 CATALOGUE_SECONDS, 'CelesTrak SATCAT')
FEEDS = (visual, starlink, catalogue)


def merge_elements(*groups: list[dict]) -> list[dict]:
    """One entry per NORAD catalogue number; later groups take precedence."""
    merged = {norad_id(e['NORAD_CAT_ID']): {**e, 'NORAD_CAT_ID': norad_id(e['NORAD_CAT_ID'])}
              for group in groups for e in group}
    return list(merged.values())


def combined() -> dict:
    """Every group, deduplicated, with SATCAT metadata and per-group timestamps."""
    return {**visual.snapshot, 'source': 'CelesTrak visual + Starlink groups',
            'elements': merge_elements(starlink.snapshot['elements'], visual.snapshot['elements']),
            'catalogue': catalogue.snapshot,
            'groups': {'visual': visual.fetched_at, 'starlink': starlink.fetched_at},
            'cached': visual.stale or starlink.stale}

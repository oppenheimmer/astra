"""CelesTrak orbital elements and SATCAT metadata, served from bundled snapshots."""
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


def valid_elements(items: Any) -> list[dict]:
    if (not isinstance(items, list) or not items or len(items) > MAX_ELEMENTS or
            any(not isinstance(e, dict) or 'NORAD_CAT_ID' not in e or 'EPOCH' not in e for e in items)):
        raise ValueError('Invalid orbital-data response')
    return items


def fetch_elements(group: str, timeout: float) -> dict:
    response = requests.get(ELEMENTS_URL, params={'GROUP': group, 'FORMAT': 'JSON'},
                            headers=HEADERS, timeout=timeout)
    if response.status_code == 403:
        raise NotModified(response.text.strip()[:200])
    response.raise_for_status()
    return {'elements': valid_elements(response.json())}


def catalogue_entry(record: dict) -> dict:
    return {'objectType': record.get('OBJECT_TYPE', 'UNK'), 'owner': record.get('OWNER', ''),
            'launchDate': record.get('LAUNCH_DATE', ''), 'internationalId': record.get('OBJECT_ID', '')}


def fetch_catalogue() -> dict:
    response = requests.get(SATCAT_URL, params={'GROUP': 'visual', 'FORMAT': 'JSON'},
                            headers=HEADERS, timeout=20)
    response.raise_for_status()
    records = response.json()
    if not isinstance(records, list) or not records:
        raise ValueError('Invalid satellite catalogue')
    return {'objects': {str(r['NORAD_CAT_ID']): catalogue_entry(r) for r in records}}


visual = Feed(snapshot('satellites.json'), lambda: fetch_elements('visual', 20),
              ELEMENT_SECONDS, 'CelesTrak visual group')
starlink = Feed(snapshot('starlink.json'), lambda: fetch_elements('starlink', 30),
                ELEMENT_SECONDS, 'CelesTrak Starlink group')
catalogue = Feed(snapshot('satellite-catalogue.json'), lambda: fetch_catalogue(),
                 CATALOGUE_SECONDS, 'CelesTrak SATCAT')
FEEDS = (visual, starlink, catalogue)


def merge_elements(*groups: list[dict]) -> list[dict]:
    """One entry per NORAD catalogue number; later groups take precedence."""
    merged = {e['NORAD_CAT_ID']: e for group in groups for e in group}
    return list(merged.values())


def combined() -> dict:
    """Every group, deduplicated, with SATCAT metadata and per-group timestamps."""
    return {**visual.snapshot, 'source': 'CelesTrak visual + Starlink groups',
            'elements': merge_elements(starlink.snapshot['elements'], visual.snapshot['elements']),
            'catalogue': catalogue.snapshot,
            'groups': {'visual': visual.fetched_at, 'starlink': starlink.fetched_at},
            'cached': visual.stale or starlink.stale}

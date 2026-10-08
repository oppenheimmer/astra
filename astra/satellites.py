"""CelesTrak orbital elements and SATCAT metadata, served from bundled snapshots."""
from typing import Any

import requests

from . import satnogs, snapshot
# Re-exported: the refresh and the tests reach the validators through this module.
from .elements import EPOCH_FORMAT, MAX_ELEMENTS, norad_id, orbital_number, valid_elements  # noqa: F401
from .feeds import Feed, NotModified
from .upstream import HEADERS

ELEMENTS_URL = 'https://celestrak.org/NORAD/elements/gp.php'
SATCAT_URL = 'https://celestrak.org/satcat/records.php'
ELEMENT_SECONDS = 7200
CATALOGUE_SECONDS = 86400
SATNOGS_SECONDS = 43200


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
    # Every object type is kept, not just payloads: `payloads_only` needs to see a
    # rocket body's classification in order to remove its elements.
    response = requests.get(SATCAT_URL, params={'GROUP': 'active', 'FORMAT': 'JSON'},
                            headers=HEADERS, timeout=30)
    response.raise_for_status()
    records = response.json()
    if not isinstance(records, list) or not records or len(records) > MAX_ELEMENTS:
        raise ValueError('Invalid satellite catalogue')
    return {'objects': {str(norad_id(r['NORAD_CAT_ID'])): catalogue_entry(r) for r in records}}


active = Feed(snapshot('active.json'), lambda: fetch_elements('active', 30),
              ELEMENT_SECONDS, 'CelesTrak active group')
catalogue = Feed(snapshot('active-catalogue.json'), lambda: fetch_catalogue(),
                 CATALOGUE_SECONDS, 'CelesTrak SATCAT')
radio = Feed(snapshot('satnogs.json'), satnogs.fetch, SATNOGS_SECONDS, satnogs.SOURCE)
FEEDS = (active, catalogue, radio)


def merge_elements(*groups: list[dict]) -> list[dict]:
    """One entry per NORAD catalogue number; later groups take precedence."""
    merged = {norad_id(e['NORAD_CAT_ID']): {**e, 'NORAD_CAT_ID': norad_id(e['NORAD_CAT_ID'])}
              for group in groups for e in group}
    return list(merged.values())


def payloads_only(elements: list[dict], objects: dict) -> list[dict]:
    """Drop elements that SATCAT classifies as anything other than a payload.

    CelesTrak's active group occasionally lists a rocket body, so membership alone
    is not enough. Only an explicit classification removes an object, though: one
    missing from the catalogue (a launch SATCAT has not caught up with, or an older
    fallback catalogue) is kept, or a single failed SATCAT download could empty the
    sky instead of merely leaving some satellites without metadata.
    """
    return [e for e in elements
            if objects.get(str(norad_id(e['NORAD_CAT_ID'])), {}).get('objectType', 'PAY') == 'PAY']


def with_satnogs(celestrak: list[dict], snapshot: dict | None, objects: dict) -> tuple[list[dict], dict]:
    """CelesTrak's elements plus SatNOGS orbits for numbers CelesTrak lacks, payloads only.

    CelesTrak wins any NORAD number both list. Radio details are kept only for
    satellites that are published, and SatNOGS is named as the orbit's source
    only where it supplied the orbit.
    """
    snapshot = snapshot or {}
    taken = {e['NORAD_CAT_ID'] for e in celestrak}
    extra = [e for e in snapshot.get('elements', []) if e['NORAD_CAT_ID'] not in taken]
    elements = payloads_only(celestrak + extra, objects)
    published = {str(e['NORAD_CAT_ID']) for e in elements}
    radio_details = {key: ({**value, 'orbitSource': ''} if int(key) in taken else value)
                     for key, value in snapshot.get('objects', {}).items() if key in published}
    return elements, radio_details


def combined() -> dict:
    """The active group and SatNOGS orbits, deduplicated and without non-payloads, with their metadata."""
    elements, radio_details = with_satnogs(merge_elements(active.snapshot['elements']), radio.snapshot,
                                           catalogue.snapshot.get('objects', {}))
    return {**active.snapshot, 'source': f'CelesTrak active group + {satnogs.SOURCE}',
            'elements': elements,
            'catalogue': catalogue.snapshot,
            'satnogs': {'fetchedAt': radio.fetched_at, 'source': satnogs.SOURCE, 'objects': radio_details},
            'groups': {'active': active.fetched_at, 'satnogs': radio.fetched_at},
            'cached': active.stale}

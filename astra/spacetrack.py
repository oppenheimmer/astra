"""Space-Track.org: the full public catalogue, for debris, rocket bodies and inactive satellites.

CelesTrak publishes elements for active satellites and a few debris clouds;
the complete catalogue of tracked objects comes from Space-Track, which needs
an account. Credentials are read from SPACETRACK_IDENTITY and
SPACETRACK_PASSWORD and are never written anywhere. Space-Track's user
agreement governs how its data may be shared.

One request per refresh fetches the newest element set of every object still
in orbit, which is the query Space-Track recommends for this purpose and asks
callers to run no more than once an hour.
"""
import os
from typing import Any

import requests

from .elements import valid_elements
from .upstream import HEADERS

SOURCE = 'Space-Track.org'
BASE = 'https://www.space-track.org'
CATALOGUE = (f'{BASE}/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-30'
             '/orderby/norad_cat_id/format/json')
# The OMM fields the browser propagates; Space-Track adds many more per record.
FIELDS = ('OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION', 'RA_OF_ASC_NODE',
          'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'EPHEMERIS_TYPE', 'CLASSIFICATION_TYPE', 'NORAD_CAT_ID',
          'ELEMENT_SET_NO', 'REV_AT_EPOCH', 'BSTAR', 'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT')
TYPES = {'PAYLOAD': 'PAY', 'ROCKET BODY': 'R/B', 'DEBRIS': 'DEB'}


class NotConfigured(ValueError):
    """No credentials: the refresh keeps any previous copy and carries on without the full catalogue."""


def credentials() -> tuple[str, str]:
    identity, password = os.environ.get('SPACETRACK_IDENTITY', ''), os.environ.get('SPACETRACK_PASSWORD', '')
    if not identity or not password:
        raise NotConfigured('SPACETRACK_IDENTITY and SPACETRACK_PASSWORD are not set')
    return identity, password


def convert(records: Any) -> dict:
    """Elements and SATCAT-style metadata, keeping each valid record and dropping each invalid one."""
    if not isinstance(records, list) or not records:
        raise ValueError('Invalid Space-Track response')
    elements, objects = [], {}
    for record in records:
        if not isinstance(record, dict):
            continue
        try:
            element = valid_elements([{key: record[key] for key in FIELDS if record.get(key) is not None}])[0]
        except ValueError:
            continue
        elements.append(element)
        text = lambda key: record.get(key) if isinstance(record.get(key), str) else ''  # noqa: E731
        objects[str(element['NORAD_CAT_ID'])] = {
            'objectType': TYPES.get(text('OBJECT_TYPE'), 'UNK'), 'owner': text('COUNTRY_CODE'),
            'launchDate': text('LAUNCH_DATE'), 'internationalId': text('OBJECT_ID'),
        }
    if not elements:
        raise ValueError('No valid Space-Track elements')
    return {'elements': elements, 'objects': objects}


def fetch(timeout: float = 240) -> dict:
    identity, password = credentials()
    with requests.Session() as session:
        session.headers.update(HEADERS)
        login = session.post(f'{BASE}/ajaxauth/login', data={'identity': identity, 'password': password}, timeout=60)
        login.raise_for_status()
        # A rejected login is still HTTP 200, with a JSON body saying so.
        if '"Login":"Failed"' in login.text.replace(' ', ''):
            raise ValueError('Space-Track login failed')
        try:
            response = session.get(CATALOGUE, timeout=timeout)
            response.raise_for_status()
            return convert(response.json())
        finally:
            try:
                session.get(f'{BASE}/ajaxauth/logout', timeout=30)
            except requests.RequestException:
                pass

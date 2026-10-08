"""Validation shared by every source of orbital elements, whatever format it arrives in."""
from datetime import datetime, timezone
import math
import re
from typing import Any

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

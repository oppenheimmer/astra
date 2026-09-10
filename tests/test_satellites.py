import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from astra import satellites
from astra.feeds import Feed


def element():
    return {'NORAD_CAT_ID': 25544, 'EPOCH': '2026-09-09T04:00:00', 'OBJECT_NAME': 'ISS',
            'MEAN_MOTION': 15.5, 'ECCENTRICITY': 0.001, 'INCLINATION': 51.6,
            'RA_OF_ASC_NODE': 10, 'ARG_OF_PERICENTER': 20, 'MEAN_ANOMALY': 30,
            'BSTAR': 0.00001, 'MEAN_MOTION_DOT': 0, 'MEAN_MOTION_DDOT': 0}


class OrbitalValidation(unittest.TestCase):
    def test_normalizes_numeric_strings_ids_and_utc_epochs_without_mutating_input(self):
        source = {**element(), 'NORAD_CAT_ID': '025544', 'MEAN_MOTION': '15.5',
                  'EPOCH': '2026-09-09T06:00:00+02:00'}
        normalized = satellites.valid_elements([source])[0]
        self.assertEqual(normalized['NORAD_CAT_ID'], 25544)
        self.assertEqual(normalized['MEAN_MOTION'], 15.5)
        self.assertEqual(normalized['EPOCH'], '2026-09-09T04:00:00Z')
        self.assertEqual(source['NORAD_CAT_ID'], '025544')
        self.assertEqual(normalized['OBJECT_ID'], '')
        self.assertEqual(normalized['ELEMENT_SET_NO'], 0)

    def test_rejects_malformed_numbers_calendar_dates_and_out_of_range_orbits(self):
        invalid = {'NORAD_CAT_ID': [[], {}, True, 0, -1, 1.2, '1.5'],
                   'EPOCH': [[], '2026-02-30T00:00:00', '2026-09-09', 'tomorrow'],
                   'OBJECT_NAME': ['', None, []], 'MEAN_MOTION': [0, -1, 21, 'NaN', float('inf'), True],
                   'ECCENTRICITY': [-0.1, 1], 'INCLINATION': [-1, 181],
                   'RA_OF_ASC_NODE': [-1, 360], 'ARG_OF_PERICENTER': [360], 'MEAN_ANOMALY': [360],
                   'BSTAR': [None, 'Infinity'], 'MEAN_MOTION_DOT': [{}], 'MEAN_MOTION_DDOT': [[]],
                   'OBJECT_ID': [[]], 'ELEMENT_SET_NO': [-1, 0.5, {}]}
        for key, values in invalid.items():
            for value in values:
                with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                    satellites.valid_elements([{**element(), key: value}])
        for key in ('MEAN_MOTION', 'BSTAR', 'EPOCH'):
            missing = element()
            del missing[key]
            with self.assertRaises(ValueError):
                satellites.valid_elements([missing])

    def test_one_invalid_element_preserves_the_entire_previous_healthy_feed(self):
        healthy = {'fetchedAt': '2020-01-01T00:00:00Z', 'elements': [element()]}
        response = MagicMock(status_code=200)
        response.json.return_value = [element(), {**element(), 'NORAD_CAT_ID': []}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'feed.json'
            path.write_text(json.dumps(healthy))
            feed = Feed(path, lambda: satellites.fetch_elements('visual', 20), 1, 'live')
            with patch.object(satellites.requests, 'get', return_value=response):
                self.assertFalse(asyncio.run(feed.refresh()))
            self.assertEqual(feed.snapshot, healthy)

    def test_bundled_snapshots_satisfy_the_stronger_schema(self):
        for feed in (satellites.visual, satellites.starlink):
            normalized = satellites.valid_elements(feed.snapshot['elements'])
            self.assertEqual(len(normalized), len(feed.snapshot['elements']))

    def test_catalogue_metadata_has_safe_defaults_and_rejects_containers(self):
        self.assertEqual(satellites.valid_catalogue({'025544': {'objectType': 'other'}}),
                         {'25544': {'objectType': 'UNK', 'owner': '', 'launchDate': '', 'internationalId': ''}})
        with self.assertRaises(ValueError):
            satellites.valid_catalogue({'25544': {'owner': []}})


if __name__ == '__main__':
    unittest.main()

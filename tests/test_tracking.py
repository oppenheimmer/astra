"""The optional layers: debris and inactive objects, and deep-space craft from JPL Horizons."""
import importlib.util
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

import astra
from astra import deep_space, spacetrack

if 'refresh_satellites' not in sys.modules:
    spec = importlib.util.spec_from_file_location('refresh_satellites', Path(astra.ROOT) / 'scripts/refresh_satellites.py')
    sys.modules['refresh_satellites'] = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sys.modules['refresh_satellites'])
refresh_satellites = sys.modules['refresh_satellites']


def element(norad, name='OBJ', epoch='2026-09-09T04:00:00'):
    return {'NORAD_CAT_ID': str(norad), 'EPOCH': epoch, 'OBJECT_NAME': name, 'OBJECT_ID': '1999-025A',
            'MEAN_MOTION': '14.1', 'ECCENTRICITY': '0.003', 'INCLINATION': '98.6', 'RA_OF_ASC_NODE': '10',
            'ARG_OF_PERICENTER': '20', 'MEAN_ANOMALY': '30', 'BSTAR': '0.0001', 'MEAN_MOTION_DOT': '0',
            'MEAN_MOTION_DDOT': '0'}


class SpaceTrack(unittest.TestCase):
    def test_needs_credentials_and_treats_their_absence_as_an_unavailable_source(self):
        with patch.dict(os.environ, {'SPACETRACK_IDENTITY': '', 'SPACETRACK_PASSWORD': ''}):
            with self.assertRaises(spacetrack.NotConfigured):
                spacetrack.fetch()
        self.assertTrue(issubclass(spacetrack.NotConfigured, ValueError), 'the refresh keeps previous data for it')

    def test_converts_records_to_lean_elements_and_catalogue_types(self):
        records = [
            {**element(25730, 'FENGYUN 1C DEB'), 'OBJECT_TYPE': 'DEBRIS', 'COUNTRY_CODE': 'PRC',
             'LAUNCH_DATE': '1999-05-10', 'TLE_LINE1': '1 ...', 'GP_ID': '1'},
            {**element(25731, 'CZ-4 R/B'), 'OBJECT_TYPE': 'ROCKET BODY'},
            {**element(25732, 'OLD SAT'), 'OBJECT_TYPE': 'PAYLOAD'},
            {**element(25733, 'MYSTERY'), 'OBJECT_TYPE': 'TBA'},
            {**element(25734), 'ECCENTRICITY': '1.5'},
            'not a record',
        ]
        result = spacetrack.convert(records)
        self.assertEqual([e['NORAD_CAT_ID'] for e in result['elements']], [25730, 25731, 25732, 25733],
                         'an invalid record is dropped on its own')
        self.assertNotIn('TLE_LINE1', result['elements'][0], 'only the propagated fields are kept')
        self.assertEqual(result['elements'][0]['MEAN_MOTION'], 14.1)
        self.assertEqual([result['objects'][str(n)]['objectType'] for n in range(25730, 25734)],
                         ['DEB', 'R/B', 'PAY', 'UNK'])
        self.assertEqual(result['objects']['25730']['owner'], 'PRC')

    def test_logs_in_queries_once_and_logs_out_even_when_the_query_fails(self):
        session = MagicMock()
        session.__enter__.return_value = session
        session.post.return_value = MagicMock(text='""')
        session.get.side_effect = [requests.Timeout('slow'), MagicMock()]
        with patch.dict(os.environ, {'SPACETRACK_IDENTITY': 'me', 'SPACETRACK_PASSWORD': 'secret'}), \
             patch.object(spacetrack.requests, 'Session', return_value=session):
            with self.assertRaises(requests.Timeout):
                spacetrack.fetch()
        self.assertEqual(session.post.call_args.kwargs['data'], {'identity': 'me', 'password': 'secret'})
        self.assertTrue(session.get.call_args_list[-1].args[0].endswith('/ajaxauth/logout'))

    def test_a_rejected_login_is_an_error(self):
        session = MagicMock()
        session.__enter__.return_value = session
        session.post.return_value = MagicMock(text='{"Login": "Failed"}')
        with patch.dict(os.environ, {'SPACETRACK_IDENTITY': 'me', 'SPACETRACK_PASSWORD': 'wrong'}), \
             patch.object(spacetrack.requests, 'Session', return_value=session):
            with self.assertRaises(ValueError):
                spacetrack.fetch()


def horizons(rows):
    body = '\n'.join(f'2461318.5, A.D. 2026-Oct-05 00:00:00.0000, {x}, {y}, {z},' for x, y, z in rows)
    return f'Ephemeris header\n$$SOE\n{body}\n$$EOE\nfooter'


class DeepSpace(unittest.TestCase):
    def test_reads_a_full_vector_table_in_whole_kilometres(self):
        rows = [(1.0e6 + i, -2.5e5, 3.4) for i in range(deep_space.SAMPLES)]
        positions = deep_space.parse_vectors(horizons(rows))
        self.assertEqual(len(positions), deep_space.SAMPLES * 3)
        self.assertEqual(positions[:3], [1000000, -250000, 3])

    def test_rejects_missing_or_partial_ephemerides(self):
        with self.assertRaises(ValueError):
            deep_space.parse_vectors('No ephemeris for target "Gaia" after A.D. 2025-MAR-27')
        with self.assertRaises(ValueError):
            deep_space.parse_vectors(horizons([(1, 2, 3)]))

    def test_samples_whole_hours_across_the_window(self):
        start, stop = deep_space.window(datetime(2026, 10, 8, 15, 47, 30, tzinfo=timezone.utc))
        self.assertEqual(start, datetime(2026, 10, 5, 15, tzinfo=timezone.utc))
        self.assertEqual((stop - start).total_seconds(), (deep_space.BEFORE_DAYS + deep_space.AFTER_DAYS) * 86400)

    def test_one_unavailable_craft_never_costs_the_others(self):
        good = [0] * (deep_space.SAMPLES * 3)
        def vectors(command, *_):
            if command == '-139479':
                raise ValueError('No ephemeris')
            return good
        with patch.object(deep_space, 'vectors', vectors):
            payload = deep_space.fetch(datetime(2026, 10, 8, tzinfo=timezone.utc))
        names = [c['name'] for c in payload['craft']]
        self.assertIn('James Webb', names)
        self.assertNotIn('Gaia', names)
        self.assertEqual(len(names), len(deep_space.CRAFT) - 1)

    def test_validation(self):
        craft = {'id': '-170', 'name': 'James Webb', 'region': 'L2', 'positions': [1, 2, 3, 4, 5, 6]}
        payload = {'start': '2026-10-05T15:00:00Z', 'step': 10800000, 'count': 2, 'craft': [craft]}
        deep_space.valid(payload)
        for bad in [{**payload, 'craft': []}, {**payload, 'count': 3}, {**payload, 'start': 'soon'},
                    {**payload, 'craft': [{**craft, 'region': 'L3'}]},
                    {**payload, 'craft': [{**craft, 'positions': [1, 2, 3, 4, 5, float('nan')]}]}, {**payload, 'craft': [1]}]:
            with self.assertRaises(ValueError):
                deep_space.valid(bad)


class InactiveLayer(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.dir = Path(self.directory.name)

    def build(self, groups, tracked, published=frozenset()):
        def fetch_elements(group, _timeout):
            result = groups.get(group)
            if result is None:
                raise requests.Timeout('down')
            return {'elements': result}
        def fetch_spacetrack():
            if isinstance(tracked, Exception):
                raise tracked
            return tracked
        with patch.object(refresh_satellites, 'fetch_elements', fetch_elements), \
             patch.object(refresh_satellites, 'fetch_spacetrack', fetch_spacetrack):
            return refresh_satellites.build_inactive(self.dir, set(published))

    def test_without_space_track_the_debris_groups_stand_alone_and_are_typed_by_name(self):
        payload = self.build({'fengyun-1c-debris': [element(25730, 'FENGYUN 1C DEB'), element(25600, 'FENGYUN 1C'),
                                                    element(25601, 'CZ-4 R/B')]},
                             spacetrack.NotConfigured('no credentials'))
        self.assertEqual(payload['source'], 'CelesTrak debris groups')
        types = {k: v['objectType'] for k, v in payload['catalogue']['objects'].items()}
        self.assertEqual(types, {'25730': 'DEB', '25600': 'PAY', '25601': 'R/B'})

    def test_space_track_wins_shared_numbers_and_published_objects_are_left_out(self):
        tracked = spacetrack.convert([{**element(25730, 'FENGYUN 1C DEB'), 'OBJECT_TYPE': 'DEBRIS', 'COUNTRY_CODE': 'PRC'},
                                      {**element(40000, 'DEAD SAT'), 'OBJECT_TYPE': 'PAYLOAD'},
                                      {**element(25544, 'ISS (ZARYA)'), 'OBJECT_TYPE': 'PAYLOAD'}])
        payload = self.build({'fengyun-1c-debris': [element(25730, 'FENGYUN 1C DEB')]}, tracked, published={25544})
        self.assertEqual(payload['source'], 'CelesTrak debris groups + Space-Track.org')
        self.assertEqual(sorted(e['NORAD_CAT_ID'] for e in payload['elements']), [25730, 40000])
        self.assertEqual(payload['catalogue']['objects']['25730']['owner'], 'PRC')
        self.assertIn('spacetrack', payload['groups'])

    def test_nothing_available_publishes_nothing(self):
        self.assertIsNone(self.build({}, spacetrack.NotConfigured('no credentials')))


if __name__ == '__main__':
    unittest.main()

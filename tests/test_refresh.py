"""The scheduled refresh: what happens when an upstream group declines to answer.

CelesTrak answers 403 when the caller already holds its newest elements, so a
partial refresh is the normal case rather than an error path, and these check
that a quiet or unreachable upstream never costs the published payload its data.
"""
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

import astra
from astra.feeds import NotModified
from astra import satellites

spec = importlib.util.spec_from_file_location(
    'refresh_satellites', Path(astra.ROOT) / 'scripts/refresh_satellites.py')
refresh_satellites = importlib.util.module_from_spec(spec)
sys.modules['refresh_satellites'] = refresh_satellites
spec.loader.exec_module(refresh_satellites)


def element(norad, epoch='2026-09-09T04:00:00'):
    return {'NORAD_CAT_ID': norad, 'EPOCH': epoch, 'OBJECT_NAME': f'OBJ-{norad}',
            'MEAN_MOTION': 15.5, 'ECCENTRICITY': 0.001, 'INCLINATION': 51.6,
            'RA_OF_ASC_NODE': 10, 'ARG_OF_PERICENTER': 20, 'MEAN_ANOMALY': 30,
            'BSTAR': 0.00001, 'MEAN_MOTION_DOT': 0, 'MEAN_MOTION_DDOT': 0}


def group(norads):
    return {'fetchedAt': datetime.now(timezone.utc).isoformat(),
            'elements': [element(n) for n in norads]}


class ConditionalFetch(unittest.TestCase):
    def test_a_403_from_celestrak_is_reported_as_not_modified(self):
        response = MagicMock(status_code=403, text='GP data has not updated since your last download')
        with patch.object(satellites.requests, 'get', return_value=response):
            with self.assertRaises(NotModified) as caught:
                satellites.fetch_elements('active', 30)
        self.assertIn('has not updated', str(caught.exception))

    def test_other_http_errors_are_still_failures(self):
        response = MagicMock(status_code=500)
        response.raise_for_status.side_effect = requests.HTTPError('server error')
        with patch.object(satellites.requests, 'get', return_value=response):
            with self.assertRaises(requests.HTTPError):
                satellites.fetch_elements('active', 30)

    def test_a_feed_treats_not_modified_as_a_benign_no_op(self):
        import asyncio
        from astra.feeds import Feed
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'feed.json'
            path.write_text(json.dumps({'fetchedAt': '2020-01-01T00:00:00+00:00', 'elements': [1]}))
            def declines():
                raise NotModified('nothing new')
            feed = Feed(path, declines, interval=1, source='live')
            self.assertFalse(asyncio.run(feed.refresh()), 'no new data is not a successful refresh')
            self.assertEqual(feed.snapshot['elements'], [1], 'the previous snapshot survives')


class Refresh(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.dir = Path(self.directory.name)
        (self.dir / 'source').mkdir()

    def seed(self, name, payload):
        (self.dir / 'source' / f'{name}.json').write_text(json.dumps(payload))

    def build(self, elements=None, catalogue=None, radio=None, run=False):
        def fetch_elements(g, _timeout):
            result = (elements or {}).get(g)
            if isinstance(result, Exception):
                raise result
            return result
        def fetch_catalogue():
            if isinstance(catalogue, Exception):
                raise catalogue
            return catalogue or {'objects': {}}
        def fetch_satnogs():
            if isinstance(radio, Exception):
                raise radio
            return radio or {'elements': [], 'objects': {}}
        with patch.object(refresh_satellites, 'fetch_elements', fetch_elements), \
             patch.object(refresh_satellites, 'fetch_catalogue', fetch_catalogue), \
             patch.object(refresh_satellites, 'fetch_satnogs', fetch_satnogs):
            return (refresh_satellites.run if run else refresh_satellites.build)(self.dir)

    def test_a_quiet_group_keeps_its_previous_elements(self):
        self.seed('active', group([100, 101]))
        payload = self.build({'active': NotModified('nothing new')})
        self.assertEqual({e['NORAD_CAT_ID'] for e in payload['elements']}, {100, 101})
        self.assertIn('active', payload['groups'])

    def test_an_outage_keeps_the_previous_elements_too(self):
        self.seed('active', group([100]))
        payload = self.build({'active': requests.Timeout('down')})
        self.assertEqual({e['NORAD_CAT_ID'] for e in payload['elements']}, {100})

    def test_a_first_run_against_an_empty_prefix_uses_the_bundled_copy(self):
        payload = self.build({'active': NotModified('nothing new')})
        bundled = json.loads((astra.DATA / 'active.json').read_text())
        self.assertEqual(len(payload['elements']), len(bundled['elements']))
        self.assertTrue((self.dir / 'source/active.json').is_file(), 'the copy is written for the next run')

    def test_objects_catalogued_as_anything_but_a_payload_are_removed(self):
        payload = self.build({'active': group([1, 2, 3, 4])}, catalogue={'objects': {
            '1': {'objectType': 'PAY'}, '2': {'objectType': 'R/B'}, '3': {'objectType': 'DEB'}}})
        self.assertEqual({e['NORAD_CAT_ID'] for e in payload['elements']}, {1, 4},
                         'rocket bodies and debris are dropped; an uncatalogued object is kept')

    def test_an_unavailable_catalogue_never_empties_the_sky(self):
        self.seed('catalogue', {'fetchedAt': 'x', 'objects': {'1': {'objectType': 'PAY'}}})
        payload = self.build({'active': group([1, 2, 3])}, catalogue=requests.Timeout('down'))
        self.assertEqual({e['NORAD_CAT_ID'] for e in payload['elements']}, {1, 2, 3},
                         'an older, smaller catalogue leaves objects without metadata, not missing')

    def test_the_payload_matches_what_the_browser_expects(self):
        payload = self.build({'active': group([1, 2])},
                             catalogue={'objects': {'1': {'objectType': 'PAY'}}})
        self.assertLessEqual({'fetchedAt', 'source', 'elements', 'catalogue', 'groups'}, payload.keys())
        self.assertFalse(payload['cached'], 'a freshly built payload is not a stale fallback')
        datetime.fromisoformat(payload['fetchedAt'])
        self.assertEqual(payload['catalogue']['objects'], {'1': {'objectType': 'PAY', 'owner': '',
                                                                'launchDate': '', 'internationalId': ''}})
        self.assertTrue(all('EPOCH' in e for e in payload['elements']))

    def test_a_run_with_no_usable_data_anywhere_fails_loudly(self):
        with patch.dict(refresh_satellites.BUNDLED, {'active': 'missing.json'}):
            with self.assertRaises(SystemExit):
                self.build({'active': requests.Timeout('down')})

    def test_invalid_upstream_elements_never_reach_the_payload(self):
        self.seed('active', group([1]))
        payload = self.build({'active': {'fetchedAt': 'x', 'elements': [{'no': 'norad id'}]}})
        self.assertEqual({e['NORAD_CAT_ID'] for e in payload['elements']}, {1})
        saved = json.loads((self.dir / 'source/active.json').read_text())
        self.assertEqual(saved['elements'][0]['NORAD_CAT_ID'], 1)

    def test_saved_and_published_elements_are_normalized_before_replacing_previous_data(self):
        payload = self.build({'active': group(['001', 1, 2])})
        self.assertEqual(sorted(e['NORAD_CAT_ID'] for e in payload['elements']), [1, 2])
        saved = json.loads((self.dir / 'source/active.json').read_text())
        self.assertEqual(saved['elements'][0]['NORAD_CAT_ID'], 1)
        self.assertTrue(saved['elements'][0]['EPOCH'].endswith('Z'))

    def test_a_run_writes_exactly_the_source_files_it_lists(self):
        """The sync publishes these and deletes every other object under source/."""
        from astra import deep_space
        sampled = {'start': '2026-09-09T00:00:00Z', 'step': 3600000, 'count': 2,
                   'craft': [{'id': '-170', 'name': 'James Webb', 'region': 'L2', 'positions': [1, 2, 3, 4, 5, 6]}]}
        groups = {g: group([1000 + i]) for i, g in enumerate(refresh_satellites.DEBRIS_GROUPS)}
        with patch.object(refresh_satellites, 'fetch_spacetrack', lambda: {'elements': group([2000])['elements'],
                                                                             'objects': {}}), \
             patch.object(refresh_satellites, 'fetch_deep_space', lambda: deep_space.valid(sampled)):
            self.build({'active': group([1]), **groups}, catalogue={'objects': {'1': {'objectType': 'PAY'}}},
                       run=True)
        self.assertEqual({p.name for p in (self.dir / 'source').iterdir()},
                         set(refresh_satellites.source_names()))
        self.assertEqual({p.name for p in self.dir.iterdir() if p.is_file()}, set(refresh_satellites.OUTPUTS))

    def test_the_source_file_list_is_available_to_the_sync_script(self):
        result = subprocess.run([sys.executable, str(astra.ROOT / 'scripts/refresh_satellites.py'), '--list-sources'],
                                capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.split(), refresh_satellites.source_names())
        self.assertNotIn('starlink.json', result.stdout, 'a retired group must be deleted, not kept')


if __name__ == '__main__':
    unittest.main()

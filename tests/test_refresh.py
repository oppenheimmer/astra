"""The scheduled refresh: what happens when an upstream group declines to answer.

CelesTrak answers 403 when the caller already holds its newest elements, so a
partial refresh is the normal case rather than an error path, and these check
that one quiet group never costs the others their data.
"""
import importlib.util
import json
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
    return {'NORAD_CAT_ID': norad, 'EPOCH': epoch, 'OBJECT_NAME': f'OBJ-{norad}'}


def group(norads):
    return {'fetchedAt': datetime.now(timezone.utc).isoformat(),
            'elements': [element(n) for n in norads]}


class ConditionalFetch(unittest.TestCase):
    def test_a_403_from_celestrak_is_reported_as_not_modified(self):
        response = MagicMock(status_code=403, text='GP data has not updated since your last download')
        with patch.object(satellites.requests, 'get', return_value=response):
            with self.assertRaises(NotModified) as caught:
                satellites.fetch_elements('starlink', 30)
        self.assertIn('has not updated', str(caught.exception))

    def test_other_http_errors_are_still_failures(self):
        response = MagicMock(status_code=500)
        response.raise_for_status.side_effect = requests.HTTPError('server error')
        with patch.object(satellites.requests, 'get', return_value=response):
            with self.assertRaises(requests.HTTPError):
                satellites.fetch_elements('visual', 20)

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

    def build(self, elements=None, catalogue=None):
        def fetch_elements(g, _timeout):
            result = (elements or {}).get(g)
            if isinstance(result, Exception):
                raise result
            return result
        def fetch_catalogue():
            if isinstance(catalogue, Exception):
                raise catalogue
            return catalogue or {'objects': {}}
        with patch.object(refresh_satellites, 'fetch_elements', fetch_elements), \
             patch.object(refresh_satellites, 'fetch_catalogue', fetch_catalogue):
            return refresh_satellites.build(self.dir)

    def test_a_quiet_group_keeps_its_previous_elements(self):
        self.seed('starlink', group([100, 101]))
        payload = self.build({'visual': group([1]), 'starlink': NotModified('nothing new')})
        self.assertEqual({e['NORAD_CAT_ID'] for e in payload['elements']}, {1, 100, 101})
        self.assertIn('visual', payload['groups'])
        self.assertIn('starlink', payload['groups'])

    def test_an_outage_keeps_the_previous_elements_too(self):
        self.seed('starlink', group([100]))
        payload = self.build({'visual': group([1]), 'starlink': requests.Timeout('down')})
        self.assertEqual({e['NORAD_CAT_ID'] for e in payload['elements']}, {1, 100})

    def test_a_first_run_against_an_empty_prefix_uses_the_bundled_copy(self):
        payload = self.build({'visual': group([1]), 'starlink': NotModified('nothing new')})
        bundled = json.loads((astra.DATA / 'starlink.json').read_text())
        self.assertGreater(len(payload['elements']), len(bundled['elements']) - 1)
        self.assertTrue((self.dir / 'source/starlink.json').is_file(), 'the copy is written for the next run')

    def test_the_visual_group_wins_a_duplicate_over_starlink(self):
        self.seed('starlink', {'fetchedAt': 'x', 'elements': [
            {'NORAD_CAT_ID': 7, 'EPOCH': 'e', 'OBJECT_NAME': 'STARLINK-DUP'}]})
        payload = self.build({'visual': {'fetchedAt': 'y', 'elements': [
            {'NORAD_CAT_ID': 7, 'EPOCH': 'e', 'OBJECT_NAME': 'ISS'}]},
            'starlink': NotModified('nothing new')})
        names = [e['OBJECT_NAME'] for e in payload['elements'] if e['NORAD_CAT_ID'] == 7]
        self.assertEqual(names, ['ISS'])

    def test_the_payload_matches_what_the_browser_expects(self):
        payload = self.build({'visual': group([1]), 'starlink': group([2])},
                             catalogue={'objects': {'1': {'objectType': 'PAY'}}})
        self.assertLessEqual({'fetchedAt', 'source', 'elements', 'catalogue', 'groups'}, payload.keys())
        self.assertFalse(payload['cached'], 'a freshly built payload is not a stale fallback')
        datetime.fromisoformat(payload['fetchedAt'])
        self.assertEqual(payload['catalogue']['objects'], {'1': {'objectType': 'PAY'}})
        self.assertTrue(all('EPOCH' in e for e in payload['elements']))

    def test_a_run_with_no_usable_data_anywhere_fails_loudly(self):
        with patch.dict(refresh_satellites.BUNDLED, {'visual': 'missing.json', 'starlink': 'missing.json'}):
            with self.assertRaises(SystemExit):
                self.build({'visual': requests.Timeout('down'), 'starlink': requests.Timeout('down')})

    def test_invalid_upstream_elements_never_reach_the_payload(self):
        self.seed('starlink', group([100]))
        with self.assertRaises(ValueError):
            self.build({'visual': {'fetchedAt': 'x', 'elements': [{'no': 'norad id'}]},
                        'starlink': NotModified('nothing new')})


if __name__ == '__main__':
    unittest.main()

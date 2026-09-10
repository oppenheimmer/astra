import asyncio
import gzip
import threading
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests
import httpx
from fastapi.testclient import TestClient

import astra
from astra import app as web, deep_stars, satellites, terrain
from astra.coalesce import Coalescer
from astra.feeds import Feed


class Api(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(web.create_app(static_dir=None))

    def test_health_declares_simulation_only(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok', 'hardware': 'simulation only'})

    def test_satellites_merge_groups_once_per_norad_id_and_label_old_snapshots(self):
        with patch.object(Feed, 'schedule_refresh', return_value=None) as schedule:
            response = self.client.get('/api/satellites')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(schedule.call_count, len(satellites.FEEDS))
        data = response.json()
        ids = [e['NORAD_CAT_ID'] for e in data['elements']]
        self.assertEqual(len(ids), len(set(ids)))
        expected = {e['NORAD_CAT_ID'] for e in satellites.visual.snapshot['elements']} | {
            e['NORAD_CAT_ID'] for e in satellites.starlink.snapshot['elements']}
        self.assertEqual(set(ids), expected)
        self.assertEqual(data['source'], 'CelesTrak visual + Starlink groups')
        self.assertEqual(data['fetchedAt'], satellites.visual.fetched_at)
        self.assertEqual(data['groups'], {'visual': satellites.visual.fetched_at,
                                          'starlink': satellites.starlink.fetched_at})
        self.assertIn('objects', data['catalogue'])
        self.assertTrue(data['cached'], 'bundled snapshots are older than the refresh interval')
        self.assertEqual(response.headers['cache-control'], 'public, max-age=300')

    def test_visual_elements_override_starlink_duplicates(self):
        merged = satellites.merge_elements([{'NORAD_CAT_ID': 1, 'g': 'starlink'}, {'NORAD_CAT_ID': 2}],
                                           [{'NORAD_CAT_ID': 1, 'g': 'visual'}])
        self.assertEqual(merged, [{'NORAD_CAT_ID': 1, 'g': 'visual'}, {'NORAD_CAT_ID': 2}])
        for bad in [[], {}, [{'EPOCH': 'x'}], [{'NORAD_CAT_ID': 1}], [1]]:
            with self.assertRaises(ValueError):
                satellites.valid_elements(bad)

    def test_horizon_is_computed_once_per_rounded_key_with_private_caching(self):
        profile = {'altitudes': [0.0] * 1440, 'approximate': True}
        with patch.object(terrain, 'horizon', return_value=profile) as horizon:
            response = self.client.get('/api/horizon', params={'lat': 46.9480001, 'lon': 7.4474, 'height': 2.04})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), profile)
        self.assertEqual(response.headers['cache-control'], 'private, max-age=86400')
        horizon.assert_called_once_with(46.948, 7.4474, 2.0)

    def test_horizon_errors_are_explicit(self):
        with patch.object(terrain, 'horizon', side_effect=ValueError('Mountain outlines are limited.')):
            self.assertEqual(self.client.get('/api/horizon', params={'lat': 84, 'lon': 0}).json(),
                             {'detail': 'Mountain outlines are limited.'})
        with patch.object(terrain, 'horizon', side_effect=requests.ConnectionError('tiles down')):
            response = self.client.get('/api/horizon', params={'lat': 46, 'lon': 7})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail'], 'Could not load terrain data. Try again.')
        with patch.object(terrain, 'horizon', side_effect=terrain.TerrainUnavailable('Invalid terrain tile dimensions')):
            response = self.client.get('/api/horizon', params={'lat': 46, 'lon': 7})
        self.assertEqual(response.status_code, 503)
        self.assertIn('Invalid terrain tile', response.json()['detail'])
        self.assertEqual(self.client.get('/api/horizon', params={'lat': 95, 'lon': 0}).status_code, 422)
        with patch.object(web, 'terrain_work', Coalescer(workers=2, backlog=0)):
            response = self.client.get('/api/horizon', params={'lat': 46, 'lon': 7})
        self.assertEqual((response.status_code, response.json()['detail']), (503, 'Terrain is busy. Try again shortly.'))

    def test_horizon_http_deadline_includes_time_waiting_for_a_worker(self):
        release = threading.Event()
        started = threading.Event()
        def occupy():
            started.set()
            return release.wait(2)
        async def scenario():
            work = Coalescer(workers=1, backlog=8)
            occupied = asyncio.create_task(work.run('occupied', occupy))
            try:
                for _ in range(100):
                    if started.is_set():
                        break
                    await asyncio.sleep(0.005)
                self.assertTrue(started.is_set())
                async with httpx.AsyncClient(transport=httpx.ASGITransport(web.create_app(None)), base_url='http://test') as client:
                    with patch.object(web, 'terrain_work', work), patch.object(web, 'TERRAIN_WAIT_SECONDS', 0.01), \
                         patch.object(terrain, 'horizon', return_value={'altitudes': []}):
                        response = await client.get('/api/horizon', params={'lat': 1, 'lon': 1})
                        self.assertEqual(response.status_code, 503)
                        self.assertIn('time limit', response.json()['detail'])
                        release.set()
                        await occupied
                        await asyncio.gather(*list(work.pending.values()))
            finally:
                release.set()
        asyncio.run(scenario())

    def test_elevation_falls_back_to_manual_entry(self):
        with patch.object(terrain, 'elevation', return_value={'elevation': 540, 'source': 'test'}) as elevation:
            self.assertEqual(self.client.get('/api/elevation', params={'lat': 46.9, 'lon': 7.4}).json(),
                             {'elevation': 540, 'source': 'test'})
            elevation.assert_called_once_with(46.9, 7.4, None, None)
        with patch.object(terrain, 'elevation', side_effect=OSError):
            response = self.client.get('/api/elevation', params={'lat': 47, 'lon': 7.4})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.client.get('/api/elevation', params={'lat': 46.9, 'lon': 7.4, 'easting': 1}).status_code, 422)

    def test_location_search_strips_markup_and_reports_outages(self):
        upstream = MagicMock()
        upstream.json.return_value = {'results': [{'attrs': {
            'label': '<b>Bundesplatz 3</b> 3011 Bern &amp; Co', 'lat': 46.9, 'lon': 7.4, 'y': 2600000, 'x': 1199000}}]}
        with patch.object(web.requests, 'get', return_value=upstream):
            response = self.client.get('/api/locations/search', params={'q': 'Bundesplatz'})
        self.assertEqual(response.json(), {'results': [{'name': 'Bundesplatz 3 3011 Bern & Co', 'lat': 46.9, 'lon': 7.4,
                                                        'easting': 2600000, 'northing': 1199000}]})
        with patch.object(web.requests, 'get', side_effect=requests.Timeout):
            self.assertEqual(self.client.get('/api/locations/search', params={'q': 'Greenwich'}).status_code, 503)
        self.assertEqual(self.client.get('/api/locations/search', params={'q': 'ab'}).status_code, 422)
        self.assertEqual(self.client.get('/api/locations/search', params={'q': '  a  '}).status_code, 422)

    def test_normalized_location_lookups_cache_successes_but_allow_failed_requests_to_retry(self):
        upstream = MagicMock()
        upstream.json.return_value = {'results': []}
        with patch.object(web.requests, 'get', side_effect=[requests.Timeout(), upstream]) as get:
            self.assertEqual(self.client.get('/api/locations/search', params={'q': '  Bern   Station '}).status_code, 503)
            self.assertEqual(self.client.get('/api/locations/search', params={'q': 'BERN Station'}).status_code, 200)
            self.assertEqual(self.client.get('/api/locations/search', params={'q': 'bern station'}).json(), {'results': []})
        self.assertEqual(get.call_count, 2)
        self.assertEqual(get.call_args.kwargs['params']['searchText'], 'bern station')
        with patch.object(terrain, 'elevation', return_value={'elevation': 100}) as elevation:
            for lat in (46.900001, 46.900002):
                self.assertEqual(self.client.get('/api/elevation', params={'lat': lat, 'lon': 7}).json(), {'elevation': 100})
        elevation.assert_called_once_with(46.9, 7.0, None, None)

    def test_full_lookup_queues_reject_excess_work_and_leave_health_available(self):
        for kind in ('search', 'elevation'):
            with self.subTest(kind=kind):
                release = threading.Event()
                active = []
                def slow(*args, **kwargs):
                    active.append(1)
                    release.wait(3)
                    response = MagicMock()
                    response.json.return_value = {'results': []}
                    return response if kind == 'search' else {'elevation': 1}
                async def scenario():
                    app = web.create_app(static_dir=None)
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://test') as client:
                        path = '/api/locations/search' if kind == 'search' else '/api/elevation'
                        params = lambda n: {'q': f'address {n}'} if kind == 'search' else {'lat': n, 'lon': 0}
                        pending = [asyncio.create_task(client.get(path, params=params(n))) for n in range(8)]
                        try:
                            for _ in range(100):
                                if len(active) == 2:
                                    break
                                await asyncio.sleep(0.005)
                            self.assertEqual(len(active), 2)
                            overflow = await asyncio.wait_for(client.get(path, params=params(9)), 0.5)
                            self.assertEqual(overflow.status_code, 503)
                            self.assertIn('busy', overflow.json()['detail'])
                            health = await asyncio.wait_for(client.get('/api/health'), 0.5)
                            self.assertEqual(health.status_code, 200)
                            duplicate = asyncio.create_task(client.get(path, params=params(0)))
                            await asyncio.sleep(0)
                        finally:
                            release.set()
                            results = await asyncio.gather(*pending)
                        self.assertTrue(all(result.status_code == 200 for result in results))
                        self.assertEqual((await duplicate).status_code, 200)
                target = web.requests if kind == 'search' else terrain
                with patch.object(target, 'get' if kind == 'search' else 'elevation', side_effect=slow):
                    asyncio.run(scenario())
                self.assertEqual(len(active), 8, 'duplicate requests share the admitted work')

    def test_deep_stars_reject_wide_fields_before_any_network_call(self):
        with patch.object(deep_stars, 'cone') as cone:
            response = self.client.get('/api/stars/deep', params={'ra': 10, 'dec': 10, 'radius': 9, 'magnitude': 14})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['detail'], 'Field too wide for this magnitude. Zoom closer.')
        cone.assert_not_called()
        self.assertEqual(self.client.get('/api/stars/deep', params={'ra': 10, 'dec': 10, 'radius': 1, 'magnitude': 7.5}).status_code, 422)

    def test_deep_stars_are_served_with_caching_and_explicit_failures(self):
        result = {'stars': [], 'truncated': False}
        with patch.object(deep_stars, 'cone', return_value=result) as cone:
            response = self.client.get('/api/stars/deep', params={'ra': 10.123456, 'dec': 10, 'radius': 1.23456, 'magnitude': 12.04})
        self.assertEqual(response.json(), result)
        self.assertEqual(response.headers['cache-control'], 'public, max-age=86400')
        cone.assert_called_once_with(10.12346, 10.0, 1.235, 12.04)
        with patch.object(deep_stars, 'cone', side_effect=requests.Timeout):
            response = self.client.get('/api/stars/deep', params={'ra': 10, 'dec': 10, 'radius': 1, 'magnitude': 12})
        self.assertEqual(response.status_code, 503)
        self.assertIn('bright-star map remains available', response.json()['detail'])

    def test_deep_star_magnitude_just_above_the_bright_layer_preserves_precision(self):
        for magnitude in (7.51, 7.500001):
            with patch.object(deep_stars, 'cone', return_value={'stars': []}) as cone:
                response = self.client.get('/api/stars/deep', params={'ra': 1, 'dec': 1, 'radius': 1, 'magnitude': magnitude})
            self.assertEqual(response.status_code, 200)
            cone.assert_called_once_with(1.0, 1.0, 1.0, magnitude)

    def test_overview_serves_gzip_only_when_real_data_is_bundled(self):
        with tempfile.TemporaryDirectory() as directory:
            pointer = Path(directory) / 'pointer.gz'
            pointer.write_text('version https://git-lfs.github.com/spec/v1\n')
            with patch.object(web, 'OVERVIEW', pointer):
                response = self.client.get('/api/stars/overview')
            self.assertEqual(response.status_code, 503)
            self.assertIn('not bundled', response.json()['detail'])
            with patch.object(web, 'OVERVIEW', Path(directory) / 'missing.gz'):
                self.assertEqual(self.client.get('/api/stars/overview').status_code, 503)
            real = Path(directory) / 'real.gz'
            real.write_bytes(gzip.compress(b'{"count": 0}'))
            with patch.object(web, 'OVERVIEW', real):
                response = self.client.get('/api/stars/overview')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['content-encoding'], 'gzip')
        self.assertEqual(response.headers['cache-control'], 'public, max-age=86400')
        self.assertEqual(response.json(), {'count': 0})

    def test_bundled_overview_is_real_gzip_data(self):
        self.assertEqual(web.OVERVIEW.read_bytes()[:2], web.GZIP_MAGIC, 'public/data/gaia-overview.json.gz is a Git LFS pointer')

    def test_snapshots_fall_back_to_the_deploy_time_copy(self):
        with tempfile.TemporaryDirectory() as directory:
            bundled = Path(directory) / 'bundled'
            bundled.mkdir()
            (bundled / 'satellites.json').write_text('{}')
            with patch.object(astra, 'DATA', Path(directory) / 'missing'), patch.object(astra, 'BUNDLED', bundled):
                self.assertEqual(astra.snapshot('satellites.json'), bundled / 'satellites.json')
                with self.assertRaises(FileNotFoundError):
                    astra.snapshot('starlink.json')
        self.assertEqual(astra.snapshot('starlink.json'), astra.DATA / 'starlink.json')

    def test_frontend_is_served_only_when_built(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'index.html').write_text('<h1>Starmap</h1>')
            client = TestClient(web.create_app(static_dir=Path(directory)))
            self.assertEqual(client.get('/').text, '<h1>Starmap</h1>')
            self.assertEqual(client.get('/api/health').status_code, 200)
            headless = TestClient(web.create_app(static_dir=Path(directory) / 'missing'))
        self.assertEqual(headless.get('/').status_code, 404)
        self.assertEqual(headless.get('/api/health').status_code, 200)


if __name__ == '__main__':
    unittest.main()

import unittest
import threading
import time
from concurrent.futures import Future
from unittest.mock import MagicMock, patch
from io import BytesIO
import numpy as np
from PIL import Image
from astra import terrain

class TerrainGeometry(unittest.TestCase):
    def test_tiles_reject_other_formats_and_bad_dimensions_before_decoding(self):
        gif = BytesIO()
        Image.new('RGB', (256, 256)).save(gif, format='GIF')
        with self.assertRaises(OSError):
            terrain.decode_tile(gif.getvalue())
        oversized = BytesIO()
        Image.new('RGB', (512, 512)).save(oversized, format='PNG')
        with patch.object(Image.Image, 'convert') as convert, self.assertRaises(terrain.TerrainUnavailable):
            terrain.decode_tile(oversized.getvalue())
        convert.assert_not_called()

    def test_tile_download_bounds_both_declared_and_streamed_sizes(self):
        for headers, chunks in [({'Content-Length': str(terrain.MAX_TILE_BYTES + 1)}, []),
                                ({}, [b'x' * terrain.MAX_TILE_BYTES, b'x'])]:
            response = MagicMock()
            response.__enter__.return_value = response
            response.headers = headers
            response.iter_content.return_value = chunks
            terrain.tile.cache_clear()
            with patch.object(terrain.requests, 'get', return_value=response), \
                 patch.object(terrain, 'decode_tile') as decode, self.assertRaises(terrain.TerrainUnavailable):
                terrain.tile(12, 0, 0)
            decode.assert_not_called()
            response.__exit__.assert_called_once()

    def test_simultaneous_requests_share_one_tile_download(self):
        release = threading.Event()
        calls = []
        def download(*key):
            calls.append(key)
            release.wait(1)
            return np.zeros((256, 256))
        with patch.object(terrain, 'tile', side_effect=download):
            first = terrain.tile_future((12, 987, 654))
            second = terrain.tile_future((12, 987, 654))
            self.assertIs(first, second)
            release.set()
            first.result(timeout=1)
        self.assertEqual(calls, [(12, 987, 654)])

    def test_shared_download_queue_has_a_global_limit(self):
        pending = []
        def submit(*args):
            future = Future()
            pending.append(future)
            return future
        try:
            with patch.object(terrain.TILE_WORKERS, 'submit', side_effect=submit):
                for key in range(terrain.MAX_TILES):
                    terrain.tile_future((18, key, 0))
                self.assertIs(terrain.tile_future((18, 0, 0)), pending[0])
                with self.assertRaises(terrain.TerrainUnavailable):
                    terrain.tile_future((18, terrain.MAX_TILES, 0))
            self.assertEqual(len(pending), terrain.MAX_TILES)
        finally:
            for future in pending:
                future.set_result(None)

    def test_sampling_deadline_returns_without_waiting_for_a_slow_shared_download(self):
        release = threading.Event()
        started = time.monotonic()
        def download(*key):
            release.wait(1)
            return np.zeros((256, 256))
        try:
            with patch.object(terrain, 'tile', side_effect=download), self.assertRaises(terrain.TerrainUnavailable):
                terrain.elevations(np.array([12]), np.array([12]), 10, terrain.TerrainBudget(seconds=0.02))
            self.assertLess(time.monotonic() - started, 0.5)
        finally:
            release.set()
            # Finish these shared tasks before another test patches the downloader.
            with terrain._tile_lock:
                remaining = list(terrain._tile_futures.values())
            for future in remaining:
                future.result(timeout=1)

    def test_tile_budget_rejects_work_before_scheduling_any_download(self):
        with patch.object(terrain, 'tile_future') as fetch, self.assertRaises(terrain.TerrainUnavailable):
            terrain.elevations(np.array([0]), np.array([0]), 12, terrain.TerrainBudget(max_tiles=0))
        fetch.assert_not_called()

    def test_horizon_uses_one_total_deadline_and_never_returns_a_partial_skyline(self):
        now = [100.0]
        budgets = []
        def heights(lat, lon, zoom, budget):
            budgets.append(budget)
            now[0] += 11
            return np.zeros(np.shape(lat))
        terrain.horizon.cache_clear()
        with patch.object(terrain.time, 'monotonic', side_effect=lambda: now[0]), \
             patch.object(terrain, 'elevations', side_effect=heights), self.assertRaises(terrain.TerrainUnavailable):
            terrain.horizon(0, 0)
        self.assertEqual(len({id(budget) for budget in budgets}), 1)
        self.assertEqual(terrain.horizon.cache_info().currsize, 0)

    def test_adaptive_high_latitude_horizon_stays_inside_tile_budget(self):
        budgets = []
        original = terrain.TerrainBudget
        def budget():
            value = original()
            budgets.append(value)
            return value
        terrain.horizon.cache_clear()
        with patch.object(terrain, 'TerrainBudget', side_effect=budget), \
             patch.object(terrain, 'tile', return_value=np.zeros((256, 256))):
            for lat in (47, 59.999, 60.001, 66, 75.5, 83):
                with self.subTest(lat=lat):
                    result = terrain.horizon(lat, 179.9)
                    self.assertLessEqual(len(budgets[-1].keys), terrain.MAX_TILES)
                    self.assertEqual(len(result['altitudes']), 1440)
                    self.assertEqual(result['rangeKm'], 200)
                    self.assertEqual(result['altitudes'], [0.0] * 1440)
        terrain.horizon.cache_clear()

    def test_height_encoding_including_below_sea_level(self):
        image = Image.new('RGB', (256, 256), (137, 219, 68))
        image.putpixel((0, 0), (127, 255, 128))
        data = BytesIO(); image.save(data, format='PNG')
        result = terrain.decode_tile(data.getvalue())
        self.assertEqual(result[0, 0], -0.5)
        self.assertEqual(result[1, 1], 2523.265625)

    def test_geodesic_bearings_and_date_line(self):
        lat, lon = terrain.destinations(0, 179.99, [0, 90, 180, 270], [10000])
        self.assertGreater(lat[0, 0], 0)
        self.assertLess(lat[2, 0], 0)
        self.assertLess(lon[1, 0], -179)
        self.assertLess(lon[3, 0], 179.99)

    def test_curvature_and_observer_height_change_visibility(self):
        distances = np.array([1000, 100000])
        flat = terrain.terrain_angles(distances, np.array([500, 500]), 500)
        self.assertLess(flat[0], 0)
        self.assertLess(flat[1], -0.4)
        hill = terrain.terrain_angles(np.array([10000]), np.array([1500]), 500)[0]
        self.assertAlmostEqual(hill, 5.666, delta=0.02)
        raised = terrain.terrain_angles(np.array([10000]), np.array([1500]), 600)[0]
        self.assertLess(raised, hill)

    def test_bilinear_sampling_has_no_tile_seam(self):
        z = 2
        # A synthetic east-sloping terrain in global pixel coordinates.
        def synthetic_tile(z, x, y):
            return np.broadcast_to(x * 256 + np.arange(256), (256, 256)).astype(float)
        pixel_x = np.array([255.75, 256.0, 256.25])
        lon = (pixel_x + 0.5) / (256 * 2**z) * 360 - 180
        with patch.object(terrain, 'tile', synthetic_tile):
            got = terrain.elevations(np.zeros(3), lon, z)
        np.testing.assert_allclose(got, pixel_x)

if __name__ == '__main__': unittest.main()

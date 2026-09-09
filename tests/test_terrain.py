import unittest
from unittest.mock import patch
from io import BytesIO
import numpy as np
from PIL import Image
from astra import terrain

class TerrainGeometry(unittest.TestCase):
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

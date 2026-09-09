import unittest
from unittest.mock import MagicMock, patch
from astra import deep_stars

HEADER='source_id,ra,dec,ref_epoch,phot_g_mean_mag,parallax,parallax_over_error,pmra,pmdec,hip_id\n'
ROW='2097863517172455552,180,30,2016,13.1,10,50,123,-12,42\n'

class DeepStars(unittest.TestCase):
    def test_archive_failure_falls_back_and_failed_responses_are_not_cached(self):
        deep_stars.cone.cache_clear()
        response = MagicMock()
        response.__enter__.return_value = response
        response.iter_content.return_value = [str(HEADER + ROW).encode()]
        try:
            with patch.object(deep_stars.requests, 'get', side_effect=deep_stars.requests.Timeout('unavailable')) as get:
                with self.assertRaises(deep_stars.requests.Timeout):
                    deep_stars.cone(180, 30, 6, 14)
                self.assertEqual(get.call_count, 2)
            with patch.object(deep_stars.requests, 'get', side_effect=[deep_stars.requests.Timeout('unavailable'), response]) as get:
                result = deep_stars.cone(180, 30, 6, 14)
                self.assertEqual(result['stars'][0]['gaiaId'], '2097863517172455552')
                self.assertEqual(result['archive'], deep_stars.ENDPOINT)
                self.assertEqual(get.call_count, 2)
        finally:
            deep_stars.cone.cache_clear()

    def test_preserves_id_epoch_magnitude_band_and_distance_units(self):
        stars,truncated=deep_stars.parse_catalogue(HEADER+ROW)
        s=stars[0]
        self.assertFalse(truncated)
        self.assertEqual(s['gaiaId'],'2097863517172455552')
        self.assertEqual(s['hip'],'42')
        self.assertEqual(s['ra'],12)
        self.assertEqual(s['epoch'],2016)
        self.assertEqual(s['band'],'G')
        self.assertAlmostEqual(s['dist'],326.16)
        self.assertAlmostEqual(s['z'],50)

    def test_does_not_invent_distance_for_missing_negative_or_noisy_parallax(self):
        for parallax,snr in [('',50),(-1,20),(1,2),(0,50),('NaN',50)]:
            row=f'123,180,30,2016,10,{parallax},{snr},,,\n'
            stars,_=deep_stars.parse_catalogue(HEADER+row)
            self.assertIsNone(stars[0]['dist'])

    def test_truncation_is_explicit_even_for_duplicate_crossmatches(self):
        with patch.object(deep_stars,'MAX_STARS',1):
            stars,truncated=deep_stars.parse_catalogue(HEADER+ROW+ROW)
        self.assertEqual(len(stars),1)
        self.assertTrue(truncated)

    def test_invalid_or_unbounded_queries_are_rejected_without_network(self):
        for args in [(0,0,16,14),(0,91,1,14),(0,0,1,30),(0,0,9,14),(float('nan'),0,1,14)]:
            with self.assertRaises(ValueError):deep_stars.cone(*args)
        with self.assertRaises(ValueError):deep_stars.parse_catalogue('<html>Error</html>')

if __name__=='__main__':unittest.main()

"""SatNOGS DB: TLE conversion, de-duplication and radio details, and how the refresh merges them."""
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import requests

import astra
from astra import satellites, satnogs

ISS = ('0 ISS (ZARYA)',
       '1 25544U 98067A   26281.01472253  .00004830  00000-0  96519-4 0  9992',
       '2 25544  51.6313 101.7328 0006804 235.9979 124.0363 15.48769982589241')
NOW = datetime(2026, 10, 8, 12, tzinfo=timezone.utc)


def with_number(line: str, number: str) -> str:
    """Replace the catalogue number in a TLE line and repair its checksum."""
    body = line[:2] + number + line[7:68]
    total = sum(int(c) if c.isdigit() else c == '-' for c in body)
    return body + str(total % 10)


def tle(sat_id, number, name='OBJ', source='Space-Track.org', epoch_day='26281.01472253'):
    line1 = with_number(ISS[1][:18] + epoch_day + ISS[1][32:], number)
    return {'tle0': f'0 {name}', 'tle1': line1, 'tle2': with_number(ISS[2], number),
            'tle_source': source, 'sat_id': sat_id, 'norad_cat_id': int(number)}


def record(sat_id, number, status='in orbit', **extra):
    return {'sat_id': sat_id, 'norad_cat_id': number, 'name': f'SAT {number}', 'status': status,
            'operator': 'None', 'countries': 'DE', 'website': '', 'launched': '2020-01-02T00:00:00Z', **extra}


def transmitter(sat_id, frequency, service='Amateur', alive=True, mode='FM', description='Beacon'):
    return {'sat_id': sat_id, 'downlink_low': frequency, 'service': service, 'alive': alive,
            'status': 'active' if alive else 'inactive', 'mode': mode, 'description': description}


class TleFields(unittest.TestCase):
    def test_converts_a_tle_to_the_omm_fields_celestrak_publishes(self):
        element = satnogs.tle_to_omm(*ISS)
        self.assertEqual(element['OBJECT_NAME'], 'ISS (ZARYA)')
        self.assertEqual(element['OBJECT_ID'], '1998-067A')
        self.assertEqual(element['NORAD_CAT_ID'], 25544)
        self.assertEqual(element['EPOCH'], '2026-10-08T00:21:12.026592Z')
        self.assertEqual(element['ECCENTRICITY'], 0.0006804)
        self.assertEqual(element['MEAN_MOTION'], 15.48769982)
        self.assertAlmostEqual(element['BSTAR'], 9.6519e-5)
        self.assertEqual(element['MEAN_MOTION_DOT'], 4.83e-5)
        self.assertEqual(element['MEAN_MOTION_DDOT'], 0)
        self.assertEqual((element['ELEMENT_SET_NO'], element['REV_AT_EPOCH']), (999, 58924))
        satellites.valid_elements([element])

    def test_rejects_bad_checksums_and_mismatched_lines(self):
        corrupt = ISS[1][:30] + ('9' if ISS[1][30] != '9' else '8') + ISS[1][31:]
        for lines in [(ISS[0], corrupt, ISS[2]), (ISS[0], ISS[1], with_number(ISS[2], '25545')),
                      (ISS[0], ISS[1][:-1], ISS[2]), ('0 ', ISS[1], ISS[2])]:
            with self.assertRaises(ValueError):
                satnogs.tle_to_omm(*lines)

    def test_reads_exponents_epochs_designators_and_alpha5_numbers(self):
        self.assertAlmostEqual(satnogs.implied_decimal('-11606-4'), -0.11606e-4)
        self.assertEqual(satnogs.implied_decimal(' 00000+0'), 0)
        self.assertEqual(satnogs.tle_epoch('99', '1.5'), '1999-01-01T12:00:00.000000Z')
        self.assertEqual(satnogs.international_id('24001AB '), '2024-001AB')
        self.assertEqual(satnogs.international_id('        '), '')
        self.assertEqual(satnogs.catalogue_number('A0001'), 100001)
        self.assertEqual(satnogs.catalogue_number('Z9999'), 339999)
        with self.assertRaises(ValueError):
            satnogs.catalogue_number('I0001')


class Build(unittest.TestCase):
    def build(self, tles, records, transmitters=()):
        return satnogs.build(list(tles), list(records), list(transmitters), now=NOW)

    def test_prefers_the_official_record_over_a_temporary_one_for_the_same_orbit(self):
        # SatNOGS follows 43822 under the temporary number 99930; the TLE line says 43822.
        temporary = tle('TEMP-0000-0000-0000-0001', '43822', name='OBJECT BS')
        temporary['norad_cat_id'] = 99930
        official = tle('REAL-0000-0000-0000-0001', '43822', name='OFFICIAL')
        for order in ([temporary, official], [official, temporary]):
            result = self.build(order, [record('TEMP-0000-0000-0000-0001', 99930, norad_follow_id=43822),
                                        record('REAL-0000-0000-0000-0001', 43822)])
            self.assertEqual([e['NORAD_CAT_ID'] for e in result['elements']], [43822])
            self.assertEqual(result['elements'][0]['OBJECT_NAME'], 'OFFICIAL')
            self.assertEqual(result['objects']['43822']['id'], 'REAL-0000-0000-0000-0001')

    def test_leaves_out_reentered_rocket_bodies_old_and_invalid_orbits(self):
        broken = tle('BRKN-0000-0000-0000-0001', '40004')
        broken['tle2'] = broken['tle2'][:-1] + '0'
        result = self.build(
            [tle('GOOD-0000-0000-0000-0001', '40001'), tle('GONE-0000-0000-0000-0001', '40002'),
             tle('ROCK-0000-0000-0000-0001', '40003', name='CZ-4B R/B'), broken,
             tle('OLDS-0000-0000-0000-0001', '40005', epoch_day='26250.00000000'),
             tle('LOST-0000-0000-0000-0001', '40006')],
            [record('GOOD-0000-0000-0000-0001', 40001), record('GONE-0000-0000-0000-0001', 40002, 're-entered'),
             record('ROCK-0000-0000-0000-0001', 40003), record('BRKN-0000-0000-0000-0001', 40004),
             record('OLDS-0000-0000-0000-0001', 40005)])
        self.assertEqual([e['NORAD_CAT_ID'] for e in result['elements']], [40001],
                         'one bad entry never costs the others their orbits')

    def test_summarizes_live_downlinks_amateur_first_without_repeats(self):
        sat = 'RDIO-0000-0000-0000-0001'
        result = self.build([tle(sat, '40001')], [record(sat, 40001, website='javascript:alert(1)')], [
            transmitter(sat, 2_400_000_000, service='Unknown'),
            transmitter(sat, 437_800_000), transmitter(sat, 437_800_000),
            transmitter(sat, 145_825_000, mode='AFSK'),
            transmitter(sat, 100_000_000, alive=False),
            transmitter(sat, 900_000_000, service='Space Research'),
        ])
        entry = result['objects']['40001']
        self.assertEqual(entry['transmitters'], 5, 'every live transmitter counts, repeats included')
        self.assertEqual([d['frequency'] for d in entry['downlinks']], [145_825_000, 437_800_000, 900_000_000])
        self.assertEqual(entry['operator'], '', 'SatNOGS writes an unknown operator as "None"')
        self.assertEqual(entry['website'], '', 'only web links are kept')
        self.assertEqual(entry['launched'], '2020-01-02')
        self.assertEqual(entry['orbitSource'], 'Space-Track.org')

    def test_radio_details_reach_satellites_whose_orbit_comes_from_elsewhere(self):
        result = self.build([tle('GOOD-0000-0000-0000-0001', '40001')],
                            [record('GOOD-0000-0000-0000-0001', 40001), record('CTRK-0000-0000-0000-0001', 25544),
                             record('QUIET000-0000-0000-0001', 25545)],
                            [transmitter('CTRK-0000-0000-0000-0001', 145_800_000)])
        self.assertEqual(result['objects']['25544']['orbitSource'], '')
        self.assertNotIn('25545', result['objects'], 'no orbit and no radio: nothing to add')

    def test_validation_rejects_unsafe_or_malformed_metadata(self):
        good = self.build([tle('GOOD-0000-0000-0000-0001', '40001')], [record('GOOD-0000-0000-0000-0001', 40001)])
        satnogs.valid_objects(good['objects'])
        entry = good['objects']['40001']
        for bad in [{**entry, 'website': 'javascript:alert(1)'}, {**entry, 'id': '<script>'},
                    {**entry, 'transmitters': -1}, {**entry, 'downlinks': [{'frequency': '145'}]}, []]:
            with self.assertRaises(ValueError):
                satnogs.valid_objects({'40001': bad})
        with self.assertRaises(ValueError):
            satnogs.build({}, [], [])

    def test_the_bundled_snapshot_satisfies_the_schema(self):
        bundled = json.loads((astra.DATA / 'satnogs.json').read_text())
        self.assertEqual(bundled['source'], 'SatNOGS DB')
        satellites.valid_elements(bundled['elements'])
        satnogs.valid_objects(bundled['objects'])


spec = importlib.util.spec_from_file_location('refresh_satellites', Path(astra.ROOT) / 'scripts/refresh_satellites.py')
refresh_satellites = sys.modules.get('refresh_satellites') or importlib.util.module_from_spec(spec)
if 'refresh_satellites' not in sys.modules:
    sys.modules['refresh_satellites'] = refresh_satellites
    spec.loader.exec_module(refresh_satellites)


class Refresh(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.dir = Path(self.directory.name)
        (self.dir / 'source').mkdir()

    def build(self, radio):
        from unittest.mock import patch
        active = {'elements': [satnogs.tle_to_omm(*ISS)]}
        def fetch_satnogs():
            if isinstance(radio, Exception):
                raise radio
            return radio
        with patch.object(refresh_satellites, 'fetch_elements', lambda *_: active), \
             patch.object(refresh_satellites, 'fetch_catalogue', lambda: {'objects': {}}), \
             patch.object(refresh_satellites, 'fetch_satnogs', fetch_satnogs):
            return refresh_satellites.build(self.dir)

    def test_satnogs_adds_satellites_and_celestrak_wins_a_shared_number(self):
        shared = {**satnogs.tle_to_omm(*ISS), 'OBJECT_NAME': 'ISS FROM SATNOGS'}
        extra = satnogs.tle_to_omm('0 EXTRA', with_number(ISS[1], '40001'), with_number(ISS[2], '40001'))
        entry = {'id': 'GOOD-0000-0000-0000-0001', 'transmitters': 1, 'orbitSource': 'Space-Track.org',
                 'downlinks': [{'frequency': 145_800_000, 'mode': 'FM', 'description': ''}]}
        payload = self.build({'elements': [shared, extra], 'objects': {'25544': entry, '40001': entry, '40002': entry}})
        names = {e['NORAD_CAT_ID']: e['OBJECT_NAME'] for e in payload['elements']}
        self.assertEqual(names, {25544: 'ISS (ZARYA)', 40001: 'EXTRA'})
        self.assertEqual(payload['source'], 'CelesTrak active group + SatNOGS DB')
        self.assertIn('satnogs', payload['groups'])
        objects = payload['satnogs']['objects']
        self.assertEqual(set(objects), {'25544', '40001'}, 'details only for published satellites')
        self.assertEqual(objects['25544']['orbitSource'], '')
        self.assertEqual(objects['40001']['orbitSource'], 'Space-Track.org')

    def test_a_satnogs_outage_keeps_its_previous_file(self):
        extra = satnogs.tle_to_omm('0 EXTRA', with_number(ISS[1], '40001'), with_number(ISS[2], '40001'))
        (self.dir / 'source/satnogs.json').write_text(json.dumps(
            {'fetchedAt': '2026-10-08T00:00:00+00:00', 'elements': [extra], 'objects': {}}))
        payload = self.build(requests.Timeout('down'))
        self.assertIn(40001, {e['NORAD_CAT_ID'] for e in payload['elements']})
        self.assertEqual(payload['groups']['satnogs'], '2026-10-08T00:00:00+00:00')

    def test_satnogs_is_a_listed_source_file(self):
        self.assertIn('satnogs.json', refresh_satellites.source_names())


if __name__ == '__main__':
    unittest.main()

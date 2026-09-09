"""Bundle 7.5 < G <= 9 Gaia DR3 stars for whole-sky viewing, with compact rows."""
import argparse
import gzip
import json
import sys
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from astra.deep_stars import ENDPOINT, parse_catalogue

QUERY = '''SELECT g.source_id,g.ra,g.dec,g.ref_epoch,g.phot_g_mean_mag,g.parallax,
g.parallax_over_error,g.pmra,g.pmdec,x.original_ext_source_id AS hip_id
FROM gaiadr3.gaia_source AS g
LEFT OUTER JOIN gaiadr3.hipparcos2_best_neighbour AS x ON g.source_id=x.source_id
WHERE g.phot_g_mean_mag > 7.5 AND g.phot_g_mean_mag <= 9'''

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--csv', type=Path, help='Reuse a previously downloaded extract')
    args = parser.parse_args()
    if args.csv:
        text = args.csv.read_text()
    else:
        response = requests.get(ENDPOINT, params={'REQUEST': 'doQuery', 'LANG': 'ADQL',
                                'FORMAT': 'csv', 'MAXREC': 200000, 'QUERY': QUERY}, timeout=(5, 90))
        response.raise_for_status()
        text = response.text
    stars, truncated = parse_catalogue(text, limit=199999)
    if truncated or len(stars) < 100000:
        raise ValueError('Unexpected or truncated whole-sky catalogue')
    rows = [[s['gaiaId'], s['hip'], round(s['ra'], 8), round(s['dec'], 7),
             round(s['mag'], 3), s['dist'],
             round(s['pmra'], 4) if s['pmra'] is not None else None,
             round(s['pmdec'], 4) if s['pmdec'] is not None else None] for s in stars]
    data = {'source': 'Gaia DR3', 'epoch': 2016, 'magnitude': 9, 'count': len(rows),
            'columns': ['source_id', 'hip', 'ra_hours', 'dec_degrees', 'G', 'distance_ly', 'pmra', 'pmdec'],
            'rows': rows}
    target = ROOT / 'public/data/gaia-overview.json.gz'
    target.write_bytes(gzip.compress(json.dumps(data, separators=(',', ':')).encode(), mtime=0))
    print(f'{len(rows)} Gaia sources, {target.stat().st_size} compressed bytes')

if __name__ == '__main__':
    main()

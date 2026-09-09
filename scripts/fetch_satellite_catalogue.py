"""Refresh the small SATCAT snapshot for the app's visual satellite group."""
from datetime import datetime, timezone
from pathlib import Path
import json
import requests

def fetch_catalogue():
    response = requests.get('https://celestrak.org/satcat/records.php',
        params={'GROUP': 'visual', 'FORMAT': 'JSON'}, timeout=30)
    response.raise_for_status()
    records = response.json()
    objects = {str(r['NORAD_CAT_ID']): {
        'objectType': r.get('OBJECT_TYPE', 'UNK'),
        'owner': r.get('OWNER', ''),
        'launchDate': r.get('LAUNCH_DATE', ''),
        'internationalId': r.get('OBJECT_ID', ''),
    } for r in records}
    data = {'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'CelesTrak SATCAT', 'objects': objects}
    target = Path(__file__).resolve().parents[1] / 'public/data/satellite-catalogue.json'
    target.write_text(json.dumps(data, separators=(',', ':')))
    print(f'Saved catalogue metadata for {len(objects)} orbital objects.')

if __name__ == '__main__':
    fetch_catalogue()

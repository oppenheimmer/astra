"""Refresh the bundled SatNOGS DB snapshot: orbits CelesTrak's active group lacks, and radio transmitters."""
from datetime import datetime, timezone
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from astra import satnogs  # noqa: E402


def fetch_satnogs():
    data = {'fetchedAt': datetime.now(timezone.utc).isoformat(), 'source': satnogs.SOURCE, **satnogs.fetch()}
    target = ROOT / 'public/data/satnogs.json'
    target.write_text(json.dumps(data, separators=(',', ':')))
    print(f"Saved {len(data['elements'])} SatNOGS orbits and {len(data['objects'])} radio entries.")


if __name__ == '__main__':
    fetch_satnogs()

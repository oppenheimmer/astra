"""Refresh the orbital-element snapshot that the deployed chart reads.

Run on a schedule by `.github/workflows/refresh-satellites.yml`. Fetches the
CelesTrak groups, merges them into the single payload the browser loads, and
writes everything into a working directory for `upload_satellites.sh` to push
to object storage.

Partial failure is normal and is handled rather than aborted. CelesTrak answers
403 when the caller already has the newest elements for a group, and a run may
also hit an ordinary outage. In both cases the group's previous file in the
working directory is reused, so one unavailable group never discards the other.
The run fails only when it cannot assemble a usable payload at all.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from astra.feeds import FETCH_ERRORS, NotModified  # noqa: E402
from astra.satellites import (  # noqa: E402
    fetch_catalogue, fetch_elements, merge_elements, valid_elements,
)

# Written next to the merged payload so a later run can reuse a group whose
# upstream is unavailable. The browser only ever reads MERGED.
MERGED = 'satellites.json'
SOURCES = 'source'
GROUPS = ('visual', 'starlink')

# Repository copies, used only when a source has no previous run to fall back on.
# Without these a first run against an empty prefix would silently drop any group
# whose upstream happened to answer "no new data", publishing a partial payload.
BUNDLED = {
    'visual': 'satellites.json',
    'starlink': 'starlink.json',
    'catalogue': 'satellite-catalogue.json',
}


def load(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def save(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(',', ':')))


def fallback(name: str, previous: dict | None) -> tuple[dict | None, str]:
    """The previous run's file, or the repository copy on a first run."""
    if previous:
        return previous, 'keeping previous'
    bundled = load(ROOT / 'public/data' / BUNDLED[name])
    return (bundled, 'no previous run, using bundled copy') if bundled else (None, 'no data available')


def refresh(name: str, fetch, previous: dict | None) -> tuple[dict | None, str]:
    """Fresh data for one source, or the best available copy when upstream declines."""
    try:
        payload = fetch()
    except NotModified:
        kept, why = fallback(name, previous)
        return kept, f'{name}: no new data upstream, {why}'
    except FETCH_ERRORS as error:
        kept, why = fallback(name, previous)
        return kept, f'{name}: unavailable ({type(error).__name__}), {why}'
    payload['fetchedAt'] = datetime.now(timezone.utc).isoformat()
    return payload, f'{name}: refreshed'


def build(directory: Path) -> dict:
    sources = directory / SOURCES
    notes, groups, elements = [], {}, []
    for group in GROUPS:
        path = sources / f'{group}.json'
        timeout = 30 if group == 'starlink' else 20
        payload, note = refresh(group, lambda g=group, t=timeout: fetch_elements(g, t), load(path))
        notes.append(note)
        if not payload:
            continue
        save(path, payload)
        groups[group] = payload['fetchedAt']
        elements.append(valid_elements(payload['elements']))

    catalogue_path = sources / 'catalogue.json'
    catalogue, note = refresh('catalogue', fetch_catalogue, load(catalogue_path))
    notes.append(note)
    if catalogue:
        save(catalogue_path, catalogue)

    for note in notes:
        print(f'  {note}')
    if not elements:
        raise SystemExit('No orbital elements available from any source or previous run.')

    # Later groups win, so the curated visual set overrides a Starlink duplicate.
    merged = merge_elements(*reversed(elements))
    return {
        'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'source': 'CelesTrak ' + ' + '.join(g for g in GROUPS if g in groups) + ' groups',
        'elements': merged,
        'catalogue': {
            'fetchedAt': catalogue.get('fetchedAt', '') if catalogue else '',
            'source': 'CelesTrak SATCAT',
            'objects': catalogue.get('objects', {}) if catalogue else {},
        },
        'groups': groups,
        'cached': False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', type=Path, default=ROOT / 'build/satellites',
                        help='working directory holding the previous run and receiving the new one')
    directory = parser.parse_args().dir
    payload = build(directory)
    target = directory / MERGED
    save(target, payload)
    epochs = sum(1 for e in payload['elements'] if 'EPOCH' in e)
    print(f"\n{len(payload['elements'])} elements ({epochs} with an epoch), "
          f"{len(payload['catalogue']['objects'])} catalogue entries, "
          f"{target.stat().st_size / 1e6:.2f} MB -> {target}")


if __name__ == '__main__':
    main()

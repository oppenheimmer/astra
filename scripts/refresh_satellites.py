"""Refresh the orbital-element snapshot that the deployed chart reads.

Run on a schedule by `.github/workflows/refresh-satellites.yml`. Fetches the
CelesTrak groups and SatNOGS DB, merges them into the single payload the
browser loads, and writes everything into a working directory for
`sync_satellites.sh` to push to object storage. CelesTrak's elements win any
NORAD number both sources list; SatNOGS adds the satellites CelesTrak's active
group lacks and radio transmitters for every satellite it tracks.

Partial failure is normal and is handled rather than aborted. CelesTrak answers
403 when the caller already has the newest elements for a group, and a run may
also hit an ordinary outage. In both cases the group's previous file in the
working directory is reused, so one unavailable group never discards the other.
The run fails only when it cannot assemble a usable payload at all.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from astra.feeds import FETCH_ERRORS, NotModified  # noqa: E402
from astra import deep_space, satnogs, spacetrack  # noqa: E402
from astra.satellites import (  # noqa: E402
    fetch_catalogue, fetch_elements, merge_elements, valid_catalogue, valid_elements, with_satnogs,
)

# Written next to the merged payload so a later run can reuse a group whose
# upstream is unavailable. The browser reads MERGED by default; INACTIVE only
# when debris and inactive objects are switched on; DEEP_SPACE on the globe.
MERGED = 'satellites.json'
INACTIVE = 'inactive.json'
DEEP_SPACE = 'deep-space.json'
OUTPUTS = (MERGED, INACTIVE, DEEP_SPACE)
SOURCES = 'source'
# Operational satellites only. Dead payloads, rocket bodies and debris are not in
# this group, and the few rocket bodies it does list are removed by payloads_only.
GROUPS = ('active',)
# The debris clouds CelesTrak publishes without an account. Space-Track's full
# catalogue, when credentials are configured, adds every other tracked object.
DEBRIS_GROUPS = ('fengyun-1c-debris', 'cosmos-2251-debris', 'iridium-33-debris', 'cosmos-1408-debris')

# Repository copies, used only when a source has no previous run to fall back on.
# Without these a first run against an empty prefix would silently drop any group
# whose upstream happened to answer "no new data", publishing a partial payload.
BUNDLED = {
    'active': 'active.json',
    'catalogue': 'active-catalogue.json',
    'satnogs': 'satnogs.json',
}


def source_names() -> list[str]:
    """The files a run keeps under SOURCES. Anything else there is left over and safe to delete."""
    return [f'{name}.json' for name in (*GROUPS, 'catalogue', 'satnogs', *DEBRIS_GROUPS, 'spacetrack', 'deep-space')]


def load(path: Path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def save(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(',', ':')))


def validate(name: str, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValueError('Invalid satellite snapshot')
    if name == 'catalogue':
        return {**payload, 'objects': valid_catalogue(payload['objects'])}
    if name == 'spacetrack':
        return {**payload, 'elements': valid_elements(payload['elements']),
                'objects': valid_catalogue(payload['objects'])}
    if name == 'deep-space':
        return deep_space.valid(payload)
    if name == 'satnogs':
        # SatNOGS may legitimately add no orbits when CelesTrak already lists them all.
        elements = payload['elements']
        return {**payload, 'elements': valid_elements(elements) if elements else [],
                'objects': satnogs.valid_objects(payload['objects'])}
    return {**payload, 'elements': valid_elements(payload['elements'])}


def fallback(name: str, previous: dict | None) -> tuple[dict | None, str]:
    """The previous run's file, or the repository copy on a first run."""
    if previous:
        try:
            return validate(name, previous), 'keeping previous'
        except FETCH_ERRORS:
            pass
    bundled = load(ROOT / 'public/data' / BUNDLED[name]) if name in BUNDLED else None
    if bundled:
        try:
            return validate(name, bundled), 'no usable previous run, using bundled copy'
        except FETCH_ERRORS:
            pass
    return None, 'no data available'


def refresh(name: str, fetch, previous: dict | None) -> tuple[dict | None, str]:
    """Fresh data for one source, or the best available copy when upstream declines."""
    try:
        payload = validate(name, fetch())
    except NotModified:
        kept, why = fallback(name, previous)
        return kept, f'{name}: no new data upstream, {why}'
    except FETCH_ERRORS as error:
        kept, why = fallback(name, previous)
        return kept, f'{name}: unavailable ({type(error).__name__}), {why}'
    payload['fetchedAt'] = datetime.now(timezone.utc).isoformat()
    return payload, f'{name}: refreshed'


def fetch_satnogs() -> dict:
    return satnogs.fetch()


def fetch_spacetrack() -> dict:
    return spacetrack.fetch()


def fetch_deep_space() -> dict:
    return deep_space.fetch()


def build(directory: Path) -> dict:
    sources = directory / SOURCES
    notes, groups, elements = [], {}, []
    for group in GROUPS:
        path = sources / f'{group}.json'
        payload, note = refresh(group, lambda g=group: fetch_elements(g, 30), load(path))
        notes.append(note)
        if not payload:
            continue
        save(path, payload)
        groups[group] = payload['fetchedAt']
        elements.append(payload['elements'])

    catalogue_path = sources / 'catalogue.json'
    catalogue, note = refresh('catalogue', fetch_catalogue, load(catalogue_path))
    notes.append(note)
    if catalogue:
        save(catalogue_path, catalogue)

    satnogs_path = sources / 'satnogs.json'
    radio, note = refresh('satnogs', fetch_satnogs, load(satnogs_path))
    notes.append(note)
    if radio:
        save(satnogs_path, radio)

    for note in notes:
        print(f'  {note}')
    if not elements:
        raise SystemExit('No orbital elements available from any source or previous run.')

    # Earlier entries in GROUPS win a duplicate NORAD ID, and CelesTrak wins over SatNOGS.
    merged, radio_details = with_satnogs(merge_elements(*reversed(elements)), radio,
                                         catalogue.get('objects', {}) if catalogue else {})
    source = 'CelesTrak ' + ' + '.join(g for g in GROUPS if g in groups) + (' groups' if len(groups) > 1 else ' group')
    if radio:
        groups['satnogs'] = radio['fetchedAt']
        source += f' + {satnogs.SOURCE}'
    return {
        'fetchedAt': datetime.now(timezone.utc).isoformat(),
        'source': source,
        'elements': merged,
        'catalogue': {
            'fetchedAt': catalogue.get('fetchedAt', '') if catalogue else '',
            'source': 'CelesTrak SATCAT',
            'objects': catalogue.get('objects', {}) if catalogue else {},
        },
        'satnogs': {
            'fetchedAt': radio.get('fetchedAt', '') if radio else '',
            'source': satnogs.SOURCE,
            'objects': radio_details,
        },
        'groups': groups,
        'cached': False,
    }


def debris_metadata(element: dict) -> dict:
    """CelesTrak's debris groups carry no object type, but its names follow a fixed convention."""
    name = element['OBJECT_NAME']
    kind = 'DEB' if re.search(r'\bDEB\b', name) else 'R/B' if re.search(r'\bR/B\b', name) else 'PAY'
    return {'objectType': kind, 'owner': '', 'launchDate': '', 'internationalId': element.get('OBJECT_ID', '')}


def build_inactive(directory: Path, published: set[int]) -> dict | None:
    """Everything tracked that MERGED leaves out: debris, rocket bodies and inactive satellites.

    CelesTrak's debris groups need no account; Space-Track's full catalogue,
    when configured, wins any number both list because it records each
    object's type. Objects already published in MERGED are left out.
    """
    sources = directory / SOURCES
    notes, groups, debris = [], {}, []
    for group in DEBRIS_GROUPS:
        path = sources / f'{group}.json'
        payload, note = refresh(group, lambda g=group: fetch_elements(g, 30), load(path))
        notes.append(note)
        if payload:
            save(path, payload)
            groups[group] = payload['fetchedAt']
            debris.extend(payload['elements'])
    tracked_path = sources / 'spacetrack.json'
    tracked, note = refresh('spacetrack', fetch_spacetrack, load(tracked_path))
    notes.append(note)
    if tracked:
        save(tracked_path, tracked)
        groups['spacetrack'] = tracked['fetchedAt']
    for note in notes:
        print(f'  {note}')

    objects = {str(e['NORAD_CAT_ID']): debris_metadata(e) for e in debris}
    objects.update(tracked['objects'] if tracked else {})
    elements = [e for e in merge_elements(debris, tracked['elements'] if tracked else [])
                if e['NORAD_CAT_ID'] not in published]
    if not elements:
        return None
    source = ' + '.join(['CelesTrak debris groups'] * bool(debris) + [spacetrack.SOURCE] * bool(tracked))
    now = datetime.now(timezone.utc).isoformat()
    unknown = lambda e: {'objectType': 'UNK', 'owner': '', 'launchDate': '', 'internationalId': e.get('OBJECT_ID', '')}  # noqa: E731
    return {'fetchedAt': now, 'source': source, 'elements': elements,
            'catalogue': {'fetchedAt': now, 'source': source,
                          'objects': {str(e['NORAD_CAT_ID']): objects.get(str(e['NORAD_CAT_ID'])) or unknown(e)
                                      for e in elements}},
            'groups': groups, 'cached': False}


def build_deep_space(directory: Path) -> dict | None:
    path = directory / SOURCES / 'deep-space.json'
    payload, note = refresh('deep-space', fetch_deep_space, load(path))
    print(f'  {note}')
    if payload:
        save(path, payload)
        payload = {**payload, 'source': deep_space.SOURCE}
    return payload


def run(directory: Path) -> dict:
    """One full refresh: the default payload, then the optional ones beside it."""
    payload = build(directory)
    save(directory / MERGED, payload)
    published = {e['NORAD_CAT_ID'] for e in payload['elements']}
    for name, extra in ((INACTIVE, build_inactive(directory, published)), (DEEP_SPACE, build_deep_space(directory))):
        if extra:
            save(directory / name, extra)
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dir', type=Path, default=ROOT / 'build/satellites',
                        help='working directory holding the previous run and receiving the new one')
    parser.add_argument('--list-sources', action='store_true',
                        help=f'print the file names kept under {SOURCES}/, one per line, and exit')
    parser.add_argument('--list-outputs', action='store_true',
                        help='print the published file names, one per line, and exit')
    args = parser.parse_args()
    if args.list_sources:
        print('\n'.join(source_names()))
        return
    if args.list_outputs:
        print('\n'.join(OUTPUTS))
        return
    directory = args.dir
    payload = run(directory)
    target = directory / MERGED
    epochs = sum(1 for e in payload['elements'] if 'EPOCH' in e)
    print(f"\n{len(payload['elements'])} elements ({epochs} with an epoch), "
          f"{len(payload['catalogue']['objects'])} catalogue entries, "
          f"{len(payload['satnogs']['objects'])} SatNOGS entries, "
          f"{target.stat().st_size / 1e6:.2f} MB -> {target}")


if __name__ == '__main__':
    main()

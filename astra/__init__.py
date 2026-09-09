"""Starmap backend: bounded proxies for orbital, terrain and Gaia data, plus static hosting."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public/data'
DIST = ROOT / 'dist'
# Serverless bundles omit public/, so the deploy build copies the server's snapshots here.
BUNDLED = Path(__file__).resolve().parent / 'data'


def snapshot(name: str) -> Path:
    """A bundled data file, from the source tree or from the deploy-time copy."""
    for directory in (DATA, BUNDLED):
        if (directory / name).is_file():
            return directory / name
    raise FileNotFoundError(f'{name} is not bundled in {DATA} or {BUNDLED}')

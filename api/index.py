"""Vercel entry point: every /api/* request is rewritten here and handled by the FastAPI app."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from astra.app import create_app  # noqa: E402

app = create_app(static_dir=None)

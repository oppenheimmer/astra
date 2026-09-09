"""Bundled data snapshots that refresh in the background, spaced by a minimum interval."""
import asyncio
import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import requests

Payload = dict[str, Any]


class NotModified(RuntimeError):
    """An upstream that refuses a repeat download because nothing has changed.

    CelesTrak answers 403 with a plain-text body naming the caller's last
    successful download of a group. That is the expected reply to polling faster
    than the data changes, not a failure, so the existing snapshot stays current
    and the caller should neither retry nor treat it as an outage.
    """


# A refresh that raises any of these keeps the previous snapshot rather than
# replacing it with a partial or invalid one. NotModified is included because
# "no new data" and "could not reach the source" have the same handling here.
FETCH_ERRORS = (requests.RequestException, ValueError, KeyError, TypeError, NotModified)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Feed:
    """A timestamped snapshot with rate-limited background refreshes.

    The bundled snapshot is served immediately. Once it is older than
    ``interval`` seconds a refresh runs in a worker thread. A failed or invalid
    refresh keeps the previous snapshot, and no further attempt is made for
    another ``interval`` seconds, so the browser can label or hide old data
    itself instead of the server inventing fresh-looking values.
    """

    def __init__(self, path: Path, fetch: Callable[[], Payload], interval: float, source: str):
        self.path = Path(path)
        self.snapshot: Payload = json.loads(self.path.read_text())
        self.fetch = fetch
        self.interval = interval
        self.source = source
        self.last_attempt = 0.0
        self.refreshing = False

    @property
    def fetched_at(self) -> str:
        return str(self.snapshot.get('fetchedAt', ''))

    def age(self, now: float | None = None) -> float:
        """Seconds since the snapshot was fetched; infinite when the timestamp is unusable."""
        try:
            fetched = datetime.fromisoformat(self.snapshot['fetchedAt']).timestamp()
        except (KeyError, TypeError, ValueError):
            return math.inf
        return (time.time() if now is None else now) - fetched

    @property
    def stale(self) -> bool:
        return self.age() > self.interval

    def due(self) -> bool:
        return self.stale and not self.refreshing and time.time() - self.last_attempt >= self.interval

    def schedule_refresh(self) -> asyncio.Task | None:
        """Start one background refresh when the snapshot is stale and none is running or recent."""
        return asyncio.create_task(self.refresh()) if self.due() else None

    async def refresh(self) -> bool:
        if not self.due():
            return False
        self.refreshing = True
        self.last_attempt = time.time()
        try:
            payload = await asyncio.to_thread(self.fetch)
            self.snapshot = {**payload, 'fetchedAt': utc_now(), 'source': self.source}
            return True
        except FETCH_ERRORS:
            return False
        finally:
            self.refreshing = False

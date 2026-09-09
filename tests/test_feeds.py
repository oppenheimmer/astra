import asyncio
import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

from astra.feeds import Feed


def snapshot_file(directory, age):
    fetched = datetime.now(timezone.utc) - timedelta(seconds=age)
    path = Path(directory) / 'feed.json'
    path.write_text(json.dumps({'fetchedAt': fetched.isoformat(), 'source': 'bundled', 'elements': [1]}))
    return path


class Feeds(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.calls = 0

    def fetch(self):
        self.calls += 1
        return {'elements': [1, 2, 3]}

    def feed(self, age, fetch=None):
        return Feed(snapshot_file(self.directory.name, age), fetch or self.fetch, interval=100, source='live')

    def test_fresh_snapshots_are_served_without_a_refresh(self):
        feed = self.feed(age=10)
        self.assertFalse(feed.stale)
        self.assertIsNone(asyncio.run(self.schedule(feed)))
        self.assertEqual(self.calls, 0)
        self.assertEqual(feed.snapshot['elements'], [1])

    def test_stale_snapshots_refresh_with_a_new_timestamp_and_source(self):
        feed = self.feed(age=1000)
        self.assertTrue(feed.stale)
        self.assertTrue(asyncio.run(feed.refresh()))
        self.assertEqual(feed.snapshot['elements'], [1, 2, 3])
        self.assertEqual(feed.snapshot['source'], 'live')
        self.assertFalse(feed.stale)
        self.assertLess(feed.age(), 5)

    def test_failed_refresh_keeps_the_snapshot_and_waits_before_retrying(self):
        def failing():
            self.calls += 1
            raise requests.ConnectionError('offline')
        feed = self.feed(age=1000, fetch=failing)
        self.assertFalse(asyncio.run(feed.refresh()))
        self.assertEqual(feed.snapshot['source'], 'bundled')
        self.assertFalse(asyncio.run(feed.refresh()))
        self.assertEqual(self.calls, 1, 'attempts are spaced by the interval')
        feed.last_attempt = 0
        asyncio.run(feed.refresh())
        self.assertEqual(self.calls, 2)

    def test_invalid_payloads_are_rejected(self):
        def invalid():
            raise ValueError('Invalid orbital-data response')
        feed = self.feed(age=1000, fetch=invalid)
        self.assertFalse(asyncio.run(feed.refresh()))
        self.assertEqual(feed.snapshot['elements'], [1])

    def test_concurrent_refreshes_share_one_fetch(self):
        started = threading.Event()
        def slow():
            self.calls += 1
            started.wait(1)
            return {'elements': []}
        feed = self.feed(age=1000, fetch=slow)
        async def both():
            first = asyncio.create_task(feed.refresh())
            await asyncio.sleep(0.05)
            second = await feed.refresh()
            started.set()
            return await first, second
        self.assertEqual(asyncio.run(both()), (True, False))
        self.assertEqual(self.calls, 1)

    def test_unusable_timestamps_count_as_stale(self):
        path = Path(self.directory.name) / 'broken.json'
        path.write_text(json.dumps({'fetchedAt': 'yesterday', 'elements': []}))
        feed = Feed(path, self.fetch, interval=100, source='live')
        self.assertTrue(feed.stale)
        self.assertEqual(feed.fetched_at, 'yesterday')

    @staticmethod
    async def schedule(feed):
        task = feed.schedule_refresh()
        if task:
            await task
        return task


if __name__ == '__main__':
    unittest.main()

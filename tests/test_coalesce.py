import asyncio
import threading
import unittest

from astra.coalesce import Busy, Coalescer


class Coalescing(unittest.TestCase):
    def test_identical_keys_share_one_computation(self):
        calls = []
        release = threading.Event()
        def compute():
            calls.append(1)
            release.wait(1)
            return 'skyline'
        async def burst():
            work = Coalescer(workers=2, backlog=8)
            waiters = [asyncio.create_task(work.run(('a',), compute)) for _ in range(3)]
            await asyncio.sleep(0.05)
            self.assertEqual(len(work.pending), 1)
            release.set()
            results = await asyncio.gather(*waiters)
            await asyncio.sleep(0)
            self.assertEqual(work.pending, {})
            return results
        self.assertEqual(asyncio.run(burst()), ['skyline'] * 3)
        self.assertEqual(len(calls), 1)

    def test_backlog_limit_rejects_new_keys_but_not_pending_ones(self):
        release = threading.Event()
        async def scenario():
            work = Coalescer(workers=1, backlog=2)
            first = asyncio.create_task(work.run('a', lambda: release.wait(1)))
            second = asyncio.create_task(work.run('b', lambda: release.wait(1)))
            await asyncio.sleep(0.05)
            with self.assertRaises(Busy):
                await work.run('c', lambda: None)
            repeat = asyncio.create_task(work.run('a', lambda: None))
            await asyncio.sleep(0.05)
            release.set()
            return await asyncio.gather(first, second, repeat)
        self.assertEqual(asyncio.run(scenario()), [True, True, True])

    def test_errors_reach_every_waiter_and_clear_the_key(self):
        attempts = []
        def compute():
            attempts.append(1)
            if len(attempts) == 1:
                raise ValueError('bad field')
            return 'ok'
        async def scenario():
            work = Coalescer(workers=2, backlog=8)
            tasks = [asyncio.create_task(work.run('k', compute)) for _ in range(2)]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            await asyncio.sleep(0)
            self.assertEqual(work.pending, {})
            retry = await work.run('k', compute)
            return results, retry
        results, retry = asyncio.run(scenario())
        self.assertTrue(all(isinstance(r, ValueError) for r in results))
        self.assertEqual(retry, 'ok')

    def test_worker_limit_bounds_concurrency(self):
        active, peak, lock = [0], [0], threading.Lock()
        def compute():
            with lock:
                active[0] += 1
                peak[0] = max(peak[0], active[0])
            threading.Event().wait(0.05)
            with lock:
                active[0] -= 1
        async def scenario():
            work = Coalescer(workers=2, backlog=8)
            await asyncio.gather(*(work.run(i, compute) for i in range(6)))
        asyncio.run(scenario())
        self.assertEqual(peak[0], 2)

    def test_a_cancelled_waiter_does_not_cancel_the_shared_work(self):
        release = threading.Event()
        async def scenario():
            work = Coalescer(workers=1, backlog=8)
            first = asyncio.create_task(work.run('k', lambda: release.wait(1) and 'done'))
            second = asyncio.create_task(work.run('k', lambda: 'unused'))
            await asyncio.sleep(0.05)
            first.cancel()
            await asyncio.sleep(0.01)
            release.set()
            return await second
        self.assertEqual(asyncio.run(scenario()), 'done')


if __name__ == '__main__':
    unittest.main()

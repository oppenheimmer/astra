"""Share one computation between identical concurrent requests."""
import asyncio
from typing import Any, Callable, Hashable


class Busy(RuntimeError):
    """Too many distinct computations are already pending."""


class Coalescer:
    """Bounded, deduplicated background work.

    Identical keys await the same task, so a burst of equal requests costs one
    computation. At most ``workers`` computations run at once and at most
    ``backlog`` distinct keys may be pending; beyond that callers get ``Busy``
    immediately instead of queueing without limit.
    """

    def __init__(self, workers: int, backlog: int):
        self.slots = asyncio.Semaphore(workers)
        self.backlog = backlog
        self.pending: dict[Hashable, asyncio.Task] = {}

    async def run(self, key: Hashable, compute: Callable[[], Any]) -> Any:
        task = self.pending.get(key)
        if task is None:
            if len(self.pending) >= self.backlog:
                raise Busy()
            task = asyncio.create_task(self._compute(compute))
            self.pending[key] = task
            task.add_done_callback(lambda done: self._complete(key, done))
        # Shield the shared task so one disconnecting client cannot cancel it for the others.
        return await asyncio.shield(task)

    async def _compute(self, compute: Callable[[], Any]) -> Any:
        async with self.slots:
            return await asyncio.to_thread(compute)

    def _complete(self, key: Hashable, task: asyncio.Task) -> None:
        self.pending.pop(key, None)
        if not task.cancelled():
            task.exception()  # Retrieve errors even if every client disconnected.

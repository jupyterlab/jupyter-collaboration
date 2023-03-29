from __future__ import annotations

import asyncio
from logging import Logger, getLogger
from typing import Any, Callable, Coroutine, Dict, Optional

from jupyter_server.utils import ensure_async


class FileLoader:
    def __init__(
        self,
        path: str,
        file_format: str,
        file_type: str,
        contents_manager: Any,
        log: Logger | None,
        poll_interval: float | None = None,
    ) -> None:
        self._path: str = path
        self._file_format: str = file_format
        self._file_type: str = file_type
        self._last_modified = None

        self._lock = asyncio.Lock()
        self._poll_interval = poll_interval
        self._contents_manager = contents_manager

        self._log = log or getLogger(__name__)
        self._subscriptions: dict[str, Callable[[str], Coroutine[Any, Any, None]]] = {}

        if self._poll_interval:
            self._watcher = asyncio.create_task(self.watch_file())

    @property
    def path(self):
        return self._path

    def clean(self) -> None:
        self._watcher.cancel()

    def rename_file(self, path: str) -> None:
        self._path = path

    def number_of_subscriptions(self) -> int:
        return len(self._subscriptions)

    def observe(self, id: str, callback: Callable[[str], Coroutine[Any, Any, None]]) -> None:
        self._subscriptions[id] = callback

    def unobserve(self, id: str) -> None:
        del self._subscriptions[id]

    async def load_content(self, format: str, file_type: str, content: bool) -> dict[str, Any]:
        return await ensure_async(
            self._contents_manager.get(self._path, format=format, type=file_type, content=content)
        )

    async def save_content(self, model: dict[str, Any]) -> None:
        async with self._lock:
            m = await self.load_content(model["format"], model["type"], False)

            if self._last_modified is None or self._last_modified >= m["last_modified"]:
                self._log.info("Saving file: %s", self._path)
                model = await ensure_async(self._contents_manager.save(model, self._path))
                self._last_modified = model["last_modified"]

            else:
                # file changed on disk, let's revert
                self._log.info(
                    "Notifying rooms. Out-of-band changes while trying to save: %s", self._path
                )
                self._last_modified = model["last_modified"]
                # Notify that the content changed on disk
                for _, callback in self._subscriptions.items():
                    await callback("changed")

    async def watch_file(self) -> None:
        self._log.info("Watching file: %s", self._path)
        assert self._poll_interval is not None

        while True:
            await asyncio.sleep(self._poll_interval)
            await self._maybe_load_document()

    async def _maybe_load_document(self) -> None:
        async with self._lock:
            model = await self.load_content(self._file_format, self._file_type, False)

            # do nothing if the file was saved by us
            if self._last_modified is not None and self._last_modified < model["last_modified"]:
                self._log.info("Notifying rooms. The file on disk changed: %s", self._path)
                self._last_modified = model["last_modified"]
                # Notify that the content changed on disk
                for _, callback in self._subscriptions.items():
                    await callback("changed")

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger, getLogger
from typing import Any, Callable, Coroutine

from jupyter_server.utils import ensure_async


class OutOfBandChanges(Exception):
    pass


class FileLoader:
    """
    A class to centralize all the operation on a file.
    """

    def __init__(
        self,
        file_id: str,
        file_format: str,
        file_type: str,
        file_id_manager: Any,
        contents_manager: Any,
        log: Logger | None,
        poll_interval: float | None = None,
    ) -> None:
        self._file_id: str = file_id
        self._file_format: str = file_format
        self._file_type: str = file_type

        self._lock = asyncio.Lock()
        self._poll_interval = poll_interval
        self._file_id_manager = file_id_manager
        self._contents_manager = contents_manager

        self._log = log or getLogger(__name__)
        self._subscriptions: dict[
            str, Callable[[str, dict[str, Any]], Coroutine[Any, Any, None]]
        ] = {}

        self._watcher = asyncio.create_task(self._watch_file()) if self._poll_interval else None

    @property
    def path(self) -> str:
        """
        The file path.
        """
        return self._file_id_manager.get_path(self._file_id)

    @property
    def number_of_subscriptions(self) -> int:
        """
        The number of rooms subscribed to this file.
        """
        return len(self._subscriptions)

    def clean(self) -> None:
        """
        Clean up the file.

        Stops the watch task.
        """
        if self._watcher is not None:
            self._watcher.cancel()

    def observe(
        self, id: str, callback: Callable[[str, dict[str, Any]], Coroutine[Any, Any, None]]
    ) -> None:
        """
        Subscribe to the file to get notified on file changes.

            Parameters:
                    id (str): Room ID
                    callback (Callable): Callback for notifying the room.
        """
        self._subscriptions[id] = callback

    def unobserve(self, id: str) -> None:
        """
        Unsubscribe to the file.

            Parameters:
                id (str): Room ID
        """
        del self._subscriptions[id]

    async def load_content(self, format: str, file_type: str, content: bool) -> dict[str, Any]:
        """
        Load the content of the file.

            Parameters:
                format (str): File format.
                file_type (str): Content type.
                content (bool): Whether to load the content or not.

            Returns:
                model (dict): A dictionary with the metadata and content of the file.
        """
        async with self._lock:
            return await ensure_async(
                self._contents_manager.get(
                    self.path, format=format, type=file_type, content=content
                )
            )

    async def save_content(self, model: dict[str, Any]) -> dict[str, Any]:
        """
        Save the content of the file.

            Parameters:
                model (dict): A dictionary with format, type, last_modified, and content of the file.

            Returns:
                model (dict): A dictionary with the metadata and content of the file.

        ### Note:
            If there is changes on disk, this method will raise an OutOfBandChanges exception.
        """
        async with self._lock:
            path = self.path
            m = await ensure_async(
                self._contents_manager.get(
                    path, format=model["format"], type=model["type"], content=False
                )
            )

            if model["last_modified"] == m["last_modified"]:
                self._log.info("Saving file: %s", path)
                return await ensure_async(self._contents_manager.save(model, path))

            else:
                # file changed on disk, raise an error
                raise OutOfBandChanges

    async def _watch_file(self) -> None:
        """
        Async task for watching a file.
        """
        self._log.info("Watching file: %s", self.path)

        if self._poll_interval is None:
            return

        while True:
            await asyncio.sleep(self._poll_interval)
            try:
                await self._maybe_load_document()

            except Exception as e:
                self._log.error("Error watching file: %s\n%s", self.path, e)

    async def _maybe_load_document(self) -> None:
        """
        Notifies subscribed rooms about changes on the content of the file.
        """
        async with self._lock:
            path = self.path
            model = await ensure_async(
                self._contents_manager.get(
                    path, format=self._file_format, type=self._file_type, content=False
                )
            )

        # Notify that the content changed on disk
        for callback in self._subscriptions.values():
            await callback("metadata", model)

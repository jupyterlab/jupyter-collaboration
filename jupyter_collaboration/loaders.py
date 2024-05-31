# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger, getLogger
from typing import Any, Callable, Coroutine

from jupyter_server.services.contents.manager import (
    AsyncContentsManager,
    ContentsManager,
)
from jupyter_server.utils import ensure_async
from jupyter_server_fileid.manager import BaseFileIdManager

from .utils import OutOfBandChanges


class FileLoader:
    """
    A class to centralize all the operation on a file.
    """

    def __init__(
        self,
        file_id: str,
        file_id_manager: BaseFileIdManager,
        contents_manager: AsyncContentsManager | ContentsManager,
        log: Logger | None = None,
        poll_interval: float | None = None,
    ) -> None:
        self._file_id: str = file_id

        self._lock = asyncio.Lock()
        self._poll_interval = poll_interval
        self._file_id_manager = file_id_manager
        self._contents_manager = contents_manager

        self._log = log or getLogger(__name__)
        self._subscriptions: dict[str, Callable[[], Coroutine[Any, Any, None]]] = {}

        self._watcher = asyncio.create_task(self._watch_file()) if self._poll_interval else None
        self.last_modified = None

    @property
    def file_id(self) -> str:
        """File ID"""
        return self._file_id

    @property
    def path(self) -> str:
        """
        The file path.
        """
        path = self._file_id_manager.get_path(self.file_id)
        if path is None:
            raise RuntimeError(f"No path found for file ID '{self.file_id}'")
        return path

    @property
    def number_of_subscriptions(self) -> int:
        """
        The number of rooms subscribed to this file.
        """
        return len(self._subscriptions)

    async def clean(self) -> None:
        """
        Clean up the file.

        Stops the watch task.
        """
        if self._watcher is not None:
            if not self._watcher.cancelled():
                self._watcher.cancel()
            try:
                await self._watcher
            except asyncio.CancelledError:
                self._log.info(f"file watcher for '{self.file_id}' is cancelled now")

    def observe(self, id: str, callback: Callable[[], Coroutine[Any, Any, None]]) -> None:
        """
        Subscribe to the file to get notified about out-of-band file changes.

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

    async def load_content(self, format: str, file_type: str) -> dict[str, Any]:
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
            model = await ensure_async(
                self._contents_manager.get(self.path, format=format, type=file_type, content=True)
            )
            self.last_modified = model["last_modified"]
            return model

    async def maybe_save_content(self, model: dict[str, Any]) -> None:
        """
        Save the content of the file.

            Parameters:
                model (dict): A dictionary with format, type, last_modified, and content of the file.

            Raises:
                OutOfBandChanges: if the file was modified at a latter time than the model

        ### Note:
            If there is changes on disk, this method will raise an OutOfBandChanges exception.
        """
        async with self._lock:
            path = self.path
            if model["type"] not in {"directory", "file", "notebook"}:
                # fall back to file if unknown type, the content manager only knows
                # how to handle these types
                model["type"] = "file"

            m = await ensure_async(
                self._contents_manager.get(
                    path, format=model["format"], type=model["type"], content=False
                )
            )

            if self.last_modified == m["last_modified"]:
                self._log.info("Saving file: %s", path)
                # saving is shielded so that it cannot be cancelled
                # otherwise it could corrupt the file
                done_saving = asyncio.Event()
                task = asyncio.create_task(self._save_content(model, done_saving))
                try:
                    await asyncio.shield(task)
                except asyncio.CancelledError:
                    pass
                await done_saving.wait()
            else:
                # file changed on disk, raise an error
                self.last_modified = m["last_modified"]
                raise OutOfBandChanges

    async def _save_content(self, model: dict[str, Any], done_saving: asyncio.Event) -> None:
        try:
            m = await ensure_async(self._contents_manager.save(model, self.path))
            self.last_modified = m["last_modified"]
        finally:
            done_saving.set()

    async def _watch_file(self) -> None:
        """
        Async task for watching a file.
        """
        self._log.info("Watching file: %s", self.path)

        if self._poll_interval is None:
            return

        while True:
            try:
                await asyncio.sleep(self._poll_interval)
                try:
                    await self.maybe_notify()
                except Exception as e:
                    self._log.error(f"Error watching file: {self.path}\n{e!r}", exc_info=e)
            except asyncio.CancelledError:
                break

    async def maybe_notify(self) -> None:
        """
        Notifies subscribed rooms about out-of-band file changes.
        """
        do_notify = False
        async with self._lock:
            # Get model metadata; format and type are not need
            model = await ensure_async(self._contents_manager.get(self.path, content=False))

            if self.last_modified is not None and self.last_modified < model["last_modified"]:
                do_notify = True

            self.last_modified = model["last_modified"]

        if do_notify:
            # Notify out-of-band change
            # callbacks will load the file content, thus release the lock before calling them
            for callback in self._subscriptions.values():
                await callback()


class FileLoaderMapping:
    """Map rooms to file loaders."""

    def __init__(
        self,
        settings: dict,
        log: Logger | None = None,
        file_poll_interval: float | None = None,
    ) -> None:
        """
        Args:
            settings: Server settings
            log: [optional] Server log; default to local logger
            file_poll_interval: [optional] Interval between room notification; default the loader won't poll
        """
        self._settings = settings
        self.__dict: dict[str, FileLoader] = {}
        self.log = log or getLogger(__name__)
        self.file_poll_interval = file_poll_interval

    @property
    def contents_manager(self) -> AsyncContentsManager | ContentsManager:
        return self._settings["contents_manager"]

    @property
    def file_id_manager(self) -> BaseFileIdManager:
        return self._settings["file_id_manager"]

    def __contains__(self, file_id: str) -> bool:
        """Test if a file has a loader."""
        return file_id in self.__dict

    def __getitem__(self, file_id: str) -> FileLoader:
        """Get the loader for a given file.

        If there is none, create one.
        """
        path = self.file_id_manager.get_path(file_id)

        # Instantiate the FileLoader if it doesn't exist yet
        file = self.__dict.get(file_id)
        if file is None:
            self.log.info("Creating FileLoader for: %s", path)
            file = FileLoader(
                file_id,
                self.file_id_manager,
                self.contents_manager,
                self.log,
                self.file_poll_interval,
            )
            self.__dict[file_id] = file

        return file

    async def __delitem__(self, file_id: str) -> None:
        """Delete a loader for a given file."""
        await self.remove(file_id)

    async def clear(self) -> None:
        """Clear all loaders."""
        tasks = []
        for id in list(self.__dict):
            loader = self.__dict.pop(id)
            tasks.append(loader.clean())

        await asyncio.gather(*tasks)

    async def remove(self, file_id: str) -> None:
        """Remove the loader for a given file."""
        loader = self.__dict.pop(file_id)
        await loader.clean()

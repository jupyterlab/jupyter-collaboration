# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger, LogLevel, getLogger
from typing import Any, Callable, Coroutine

from jupyter_server_fileid.manager import BaseFileIdManager
from jupyter_server.services.contents.manager import AsyncContentsManager, ContentsManager
from jupyter_server.utils import ensure_async

from .utils import decode_file_path


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
        file_id_manager: BaseFileIdManager,
        contents_manager: AsyncContentsManager | ContentsManager,
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

    def __del__(self):
        """Clean the loader resources"""
        self.clean()

    @property
    def file_format(self) -> str:
        """File format"""
        return self._file_format

    @property
    def file_id(self) -> str:
        """File ID"""
        return self._file_id

    @property
    def file_type(self) -> str:
        """File type"""
        return self._file_type

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
        if self._watcher is not None and self._watcher.cancelling == 0:
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

        # TODO why is there no test this contradict the help
        # Notify that the content changed on disk
        for callback in self._subscriptions.values():
            await callback("metadata", model)


class FileLoaderMapping:
    """Map rooms to file loaders."""

    def __init__(
        self,
        file_id_manager: BaseFileIdManager,
        contents_manager: AsyncContentsManager | ContentsManager,
        log: Logger,
        file_poll_interval: int = 1,
    ) -> None:
        self.__dict: dict[str, FileLoader] = {}
        self._file_id_manager = file_id_manager
        self._contents_manager = contents_manager
        self.log = log
        self.file_poll_interval = file_poll_interval

    def __del__(self) -> None:
        for id in self.__dict:
            loader = self.__dict.pop(id)
            loader.clean()

    def __contains__(self, room_id: str) -> bool:
        """Test if a room as a loader."""
        return room_id in self.__dict

    def __getitem__(self, room_id: str) -> FileLoader:
        """Get the loader for a given room.

        If there is none, create one.
        """
        file_format, file_type, file_id = decode_file_path(room_id)
        path = self._file_id_manager.get_path(file_id)

        # Instantiate the FileLoader if it doesn't exist yet
        file = self.__dict.get(room_id) # TODO I switch for room_id instead of file_id ... current code breaks multiple view isn't it?
        if file is None:
            self.log.info("Creating FileLoader for: %s", path)
            file = FileLoader(
                file_id,
                file_format,
                file_type,
                self._file_id_manager,
                self._contents_manager,
                self.log,
                self.file_poll_interval,
            )
            self.__dict[room_id] = file

        else:
            self.log(
                LogLevel.WARNING,
                None,
                "There is another collaborative session accessing the same file.\nThe synchronization between rooms is not supported and you might lose some of your changes.",
            )

        return file

    def __delitem__(self, room_id: str) -> None:
        """Delete a loader for a given room."""
        loader = self.__dict.pop(room_id)
        loader.clean()
        self.log(LogLevel.INFO, "clean", "Loader deleted.")

    def get_loaders_from_file_id(self, file_id: str) -> list(FileLoader):
        """Returns the file loaders for a given file ID.

        Arguments:
            file_id: File ID
        Returns:
            List of FileLoader handling the file.
        """
        return [filter(lambda loader: loader.file_id == file_id, self.__dict.values())]

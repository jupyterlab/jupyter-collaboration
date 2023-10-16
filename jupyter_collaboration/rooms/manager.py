# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger, getLogger
from typing import Any

from ..loaders import FileLoaderMapping
from ..stores import BaseYStore
from ..utils import JUPYTER_COLLABORATION_EVENTS_URI, LogLevel, decode_file_path
from .base import BaseRoom
from .document import DocumentRoom
from .transient import TransientRoom


class RoomManager:
    """Map IDs to rooms."""

    def __init__(
        self,
        store: BaseYStore,
        file_loaders: FileLoaderMapping,
        event_logger: Any,
        document_save_delay: float | None = 1.0,
        log: Logger | None = None,
    ) -> None:
        self._store = store
        self._file_loaders = file_loaders
        self._event_logger = event_logger

        self._document_save_delay = document_save_delay
        self.log = log or getLogger(__name__)

        self._rooms: dict[str, BaseRoom] = {}
        self._room_tasks: dict[str, asyncio.Task] = {}
        self._clean_up_tasks: dict[str, asyncio.Task] = {}

        self._lock = asyncio.Lock()

    def has_room(self, room_id: str) -> bool:
        """Test if an id has a room."""
        return room_id in self._rooms

    async def get_room(self, room_id: str) -> BaseRoom:
        """
        Get the room for a given id.

        NOTE: If the room doesn't exits, it will create and return
        a new one.
        """
        # Use a lock to make sure two clients don't create
        # the same room.
        async with self._lock:
            # Cancel the clean up task if exists
            if room_id in self._clean_up_tasks:
                task = self._clean_up_tasks.pop(room_id)
                task.cancel()

            room = self._rooms.get(room_id, None)
            if room is not None:
                return room

            if room_id.count(":") >= 2:
                # DocumentRoom
                room = self._create_document_room(room_id)

            else:
                # TransientRoom
                # it is a transient document (e.g. awareness)
                room = TransientRoom(room_id, self.log)

            self._rooms[room_id] = room
            if not room.started.is_set():
                self._room_tasks[room_id] = asyncio.create_task(room.start())

            if not room.ready:
                await room.initialize()

            return room

    async def remove_room(self, room_id: str, delay: float = 0) -> None:
        """Remove the room for a given id."""
        # Use lock to make sure while a client is creating the
        # clean up task, no one else is accessing the room or trying to
        # deleted as well
        async with self._lock:
            if room_id in self._clean_up_tasks:
                return

            # NOTE: Should we check if there is only one client?
            # if len(self._rooms[room_id].clients) <= 1:
            self._clean_up_tasks[room_id] = asyncio.create_task(self._clean_up_room(room_id, delay))

    async def clear(self) -> None:
        """Clear all rooms."""
        tasks = []
        for id in list(self._rooms):
            tasks.append(asyncio.create_task(self._clean_up_room(id, 0)))

        await asyncio.gather(*tasks)

    def _create_document_room(self, room_id: str) -> DocumentRoom:
        file_format, file_type, file_id = decode_file_path(room_id)
        if file_id in self._file_loaders:
            self._emit(
                room_id,
                LogLevel.WARNING,
                None,
                "There is another collaborative session accessing the same file.\nThe synchronization between rooms is not supported and you might lose some of your changes.",
            )

        file = self._file_loaders[file_id]
        return DocumentRoom(
            room_id,
            file_format,
            file_type,
            file,
            self._event_logger,
            self._store,
            self.log,
            self._document_save_delay,
        )

    async def _clean_up_room(self, room_id: str, delay: float) -> None:
        """
        Async task for cleaning up the resources.

        When all the clients of a room leave, we setup a task to clean up the resources
        after a certain amount of time. We need to wait a few seconds to clean up the room
        because sometimes websockets unintentionally disconnect.

        During the clean up, we need to delete the room to free resources since the room
        contains a copy of the document. In addition, we remove the file if there is no rooms
        subscribed to it.
        """
        self.log.info("Cleaning room: %s", room_id)

        await asyncio.sleep(delay)

        # Remove the room
        room = self._rooms.pop(room_id)
        room.stop()

        task = self._room_tasks.pop(room_id)
        await task

        self.log.info("Room %s deleted", room_id)
        self._emit(room_id, LogLevel.INFO, "clean", "Room deleted.")

        # Clean the file loader if there are not rooms using it
        if room_id.count(":") >= 2:
            _, _, file_id = decode_file_path(room_id)
            file = self._file_loaders[file_id]
            if file.number_of_subscriptions == 0:
                await self._file_loaders.remove(file_id)
                self.log.info("Loader %s deleted", file.path)
                self._emit(room_id, LogLevel.INFO, "clean", "Loader deleted.")

        if room_id in self._clean_up_tasks:
            del self._clean_up_tasks[room_id]

    def _emit(
        self, room_id: str, level: LogLevel, action: str | None = None, msg: str | None = None
    ) -> None:
        if room_id.count(":") < 2:
            return

        _, _, file_id = decode_file_path(room_id)
        path = self._file_loaders.file_id_manager.get_path(file_id)

        data = {"level": level.value, "room": room_id, "path": path}
        if action:
            data["action"] = action
        if msg:
            data["msg"] = msg

        self._event_logger.emit(schema_id=JUPYTER_COLLABORATION_EVENTS_URI, data=data)

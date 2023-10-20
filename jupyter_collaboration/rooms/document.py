# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
import uuid
from logging import Logger
from typing import Any

from jupyter_events import EventLogger
from jupyter_ydoc import ydocs as YDOCS
from ypy_websocket.yutils import write_var_uint

from ..loaders import FileLoader
from ..stores import BaseYStore
from ..utils import (
    JUPYTER_COLLABORATION_EVENTS_URI,
    LogLevel,
    MessageType,
    OutOfBandChanges,
    RoomMessages,
)
from .base import BaseRoom

YFILE = YDOCS["file"]


class DocumentRoom(BaseRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    def __init__(
        self,
        room_id: str,
        file_format: str,
        file_type: str,
        file: FileLoader,
        logger: EventLogger,
        store: BaseYStore | None,
        log: Logger | None,
        save_delay: float | None = None,
    ):
        super().__init__(room_id=room_id, store=store, log=log)

        self._file_format: str = file_format
        self._file_type: str = file_type
        self._session_id = str(uuid.uuid4())
        self._last_modified: Any = None
        self._file: FileLoader = file
        self._document = YDOCS.get(self._file_type, YFILE)(self.ydoc)

        self._logger = logger
        self._save_delay = save_delay

        self._update_lock = asyncio.Lock()
        self._outofband_lock = asyncio.Lock()
        self._initialization_lock = asyncio.Lock()
        self._saving_document: asyncio.Task | None = None
        self._messages: dict[str, asyncio.Lock] = {}

        # Listen for document changes
        self._document.observe(self._on_document_change)
        self._file.observe(self.room_id, self._on_content_change)

    async def initialize(self) -> None:
        """
        Initializes the room.

        This method is thread safe so only one client can initialize the room.

        To initialize the room, we check if the content was already in the store
        as a Y updates and if it is up to date with the content on disk. In this
        case, we load the Y updates from the store. Otherwise, we load the content
        from disk.

        ### Note:
            It is important to set the ready property in the parent class (`self.ready = True`),
            this setter will subscribe for updates on the shared document.
        """
        async with self._initialization_lock:
            if self.ready:
                return

            self.log.info("Initializing room %s", self._room_id)
            model = await self._file.load_content(self._file_format, self._file_type, True)

            async with self._update_lock:
                # try to apply Y updates from the YStore for this document
                if self.ystore is not None and await self.ystore.exists(self._room_id):
                    # Load the content from the store
                    doc = await self.ystore.get(self._room_id)
                    assert doc
                    self._session_id = doc["session_id"]

                    await self.ystore.apply_updates(self._room_id, self.ydoc)
                    self._emit(
                        LogLevel.INFO,
                        "load",
                        "Content loaded from the store {}".format(
                            self.ystore.__class__.__qualname__
                        ),
                    )
                    self.log.info(
                        "Content in room %s loaded from the ystore %s",
                        self._room_id,
                        self.ystore.__class__.__name__,
                    )

                    # if YStore updates and source file are out-of-sync, resync updates with source
                    if self._document.source != model["content"]:
                        self._emit(
                            LogLevel.INFO, "initialize", "The file is out-of-sync with the ystore."
                        )
                        self.log.info(
                            "Content in file %s is out-of-sync with the ystore %s",
                            self._file.path,
                            self.ystore.__class__.__name__,
                        )

                        # Update the content
                        self._document.source = model["content"]
                        await self.ystore.encode_state_as_update(self._room_id, self.ydoc)

                else:
                    self._emit(LogLevel.INFO, "load", "Content loaded from disk.")
                    self.log.info(
                        "Content in room %s loaded from file %s", self._room_id, self._file.path
                    )
                    self._document.source = model["content"]

                    if self.ystore is not None:
                        assert self.session_id
                        await self.ystore.create(self._room_id, self.session_id)
                        await self.ystore.encode_state_as_update(self._room_id, self.ydoc)

                self._last_modified = model["last_modified"]
                self._document.dirty = False
                self.ready = True
                self._emit(LogLevel.INFO, "initialize", "Room initialized")

    async def handle_msg(self, data: bytes) -> None:
        msg_type = data[0]
        msg_id = data[2:].decode()

        # Use a lock to prevent handling responses from multiple clients
        # at the same time
        async with self._messages[msg_id]:
            # Check whether the previous client resolved the conflict
            if msg_id not in self._messages:
                return

            try:
                ans = None
                if msg_type == RoomMessages.RELOAD:
                    # Restore the room with the content from disk
                    await self._load_document()
                    ans = RoomMessages.DOC_OVERWRITTEN

                elif msg_type == RoomMessages.OVERWRITE:
                    # Overwrite the file with content from the room
                    await self._save_document()
                    ans = RoomMessages.FILE_OVERWRITTEN

                if ans is not None:
                    # Remove the lock and broadcast the resolution
                    self._messages.pop(msg_id)
                    data = msg_id.encode()
                    self._outofband_lock.release()
                    self.broadcast_msg(
                        bytes([MessageType.ROOM, ans]) + write_var_uint(len(data)) + data
                    )

            except Exception:
                return

    def _emit(self, level: LogLevel, action: str | None = None, msg: str | None = None) -> None:
        data = {"level": level.value, "room": self._room_id, "path": self._file.path}
        if action:
            data["action"] = action
        if msg:
            data["msg"] = msg

        self._logger.emit(schema_id=JUPYTER_COLLABORATION_EVENTS_URI, data=data)

    def stop(self) -> None:
        """
        Stop the room.

        Cancels the save task and unsubscribes from the file.
        """
        self._document.unobserve()
        self._file.unobserve(self.room_id)

        # TODO: Should we cancel or wait ?
        if self._saving_document:
            self._saving_document.cancel()

        return super().stop()

    async def _on_content_change(self, event: str, args: dict[str, Any]) -> None:
        """
        Called when the file changes.

            Parameters:
                event (str): Type of change.
                args (dict): A dictionary with format, type, last_modified.
        """
        if self._outofband_lock.locked():
            return

        if event == "metadata" and (
            self._last_modified is None or self._last_modified < args["last_modified"]
        ):
            await self._send_confict_msg()

    def _on_document_change(self, target: str, event: Any) -> None:
        """
        Called when the shared document changes.

            Parameters:
                target (str): The name of the changed attribute.
                event (Any): Changes.

        ### Note:
            We auto save the content of the document every time there is a
            change in it. Since we could receive a high amount of changes
            in a short period of time, we need create a task for saving the
            document. This tasks are debounced (60 seconds by default) so we
            need to cancel previous tasks before creating a new one.
        """
        if self._update_lock.locked():
            return

        if self._saving_document is not None and not self._saving_document.done():
            # the document is being saved, cancel that
            self._saving_document.cancel()
            self._saving_document = None

        self._saving_document = asyncio.create_task(self._maybe_save_document())

    async def _load_document(self) -> None:
        try:
            async with self._update_lock:
                model = await self._file.load_content(self._file_format, self._file_type, True)
                self._document.source = model["content"]
                self._last_modified = model["last_modified"]
                self._document.dirty = False

        except Exception as e:
            msg = f"Error loading content from file: {self._file.path}\n{e!r}"
            self.log.error(msg, exc_info=e)
            self._emit(LogLevel.ERROR, None, msg)
            return None

    async def _save_document(self) -> None:
        """
        Saves the content of the document to disk.
        """
        try:
            self.log.info("Saving the content from room %s", self._room_id)

            async with self._update_lock:
                model = await self._file.save_content(
                    {
                        "format": self._file_format,
                        "type": self._file_type,
                        "last_modified": self._last_modified,
                        "content": self._document.source,
                    }
                )
                self._last_modified = model["last_modified"]
                self._document.dirty = False

            self._emit(LogLevel.INFO, "save", "Content saved.")

        except Exception as e:
            msg = f"Error saving file: {self._file.path}\n{e!r}"
            self.log.error(msg, exc_info=e)
            self._emit(LogLevel.ERROR, None, msg)

    async def _maybe_save_document(self) -> None:
        """
        Saves the content of the document to disk.

        ### Note:
            There is a save delay to debounce the save since we could receive a high
            amount of changes in a short period of time. This way we can cancel the
            previous save.
        """
        if self._save_delay is None:
            return

        # save after X seconds of inactivity
        await asyncio.sleep(self._save_delay)

        if self._outofband_lock.locked():
            return

        try:
            self.log.info("Saving the content from room %s", self._room_id)
            async with self._update_lock:
                model = await self._file.maybe_save_content(
                    {
                        "format": self._file_format,
                        "type": self._file_type,
                        "last_modified": self._last_modified,
                        "content": self._document.source,
                    }
                )
                self._last_modified = model["last_modified"]
                self._document.dirty = False

            self._emit(LogLevel.INFO, "save", "Content saved.")

        except OutOfBandChanges:
            await self._send_confict_msg()

        except Exception as e:
            msg = f"Error saving file: {self._file.path}\n{e!r}"
            self.log.error(msg, exc_info=e)
            self._emit(LogLevel.ERROR, None, msg)

    async def _send_confict_msg(self) -> None:
        self.log.info("Out-of-band changes in room %s", self._room_id)
        self._emit(LogLevel.INFO, "overwrite", f"Out-of-band changes in room {self._room_id}")

        msg_id = str(uuid.uuid4())
        self._messages[msg_id] = asyncio.Lock()
        await self._outofband_lock.acquire()
        data = msg_id.encode()
        self.broadcast_msg(
            bytes([MessageType.ROOM, RoomMessages.FILE_CHANGED]) + write_var_uint(len(data)) + data
        )

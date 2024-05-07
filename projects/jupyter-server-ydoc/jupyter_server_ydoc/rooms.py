# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger
from typing import Any, Callable

from jupyter_events import EventLogger
from jupyter_ydoc import ydocs as YDOCS
from pycrdt_websocket.websocket_server import YRoom
from pycrdt_websocket.ystore import BaseYStore, YDocNotFound

from .loaders import FileLoader
from .utils import JUPYTER_COLLABORATION_EVENTS_URI, LogLevel, OutOfBandChanges

YFILE = YDOCS["file"]


class DocumentRoom(YRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    _background_tasks: set[asyncio.Task]

    def __init__(
        self,
        room_id: str,
        file_format: str,
        file_type: str,
        file: FileLoader,
        logger: EventLogger,
        ystore: BaseYStore | None,
        log: Logger | None,
        save_delay: float | None = None,
        exception_handler: Callable[[Exception, Logger], bool] | None = None,
    ):
        super().__init__(ready=False, ystore=ystore, exception_handler=exception_handler, log=log)

        self._room_id: str = room_id
        self._file_format: str = file_format
        self._file_type: str = file_type
        self._file: FileLoader = file
        self._document = YDOCS.get(self._file_type, YFILE)(self.ydoc)

        self._logger = logger
        self._save_delay = save_delay

        self._update_lock = asyncio.Lock()
        self._cleaner: asyncio.Task | None = None
        self._saving_document: asyncio.Task | None = None
        self._messages: dict[str, asyncio.Lock] = {}
        self._background_tasks = set()

        # Listen for document changes
        self._document.observe(self._on_document_change)
        self._file.observe(self.room_id, self._on_outofband_change)

    @property
    def room_id(self) -> str:
        """
        The room ID.
        """
        return self._room_id

    @property
    def cleaner(self) -> asyncio.Task | None:
        """
        The task for cleaning up the resources.
        """
        return self._cleaner

    @cleaner.setter
    def cleaner(self, value: asyncio.Task) -> None:
        """
        Setter for the clean up task.
        """
        self._cleaner = value

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
        if self.ready:  # type: ignore[has-type]
            return

        self.log.info("Initializing room %s", self._room_id)

        model = await self._file.load_content(self._file_format, self._file_type)

        async with self._update_lock:
            # try to apply Y updates from the YStore for this document
            read_from_source = True
            if self.ystore is not None:
                async with self.ystore.start_lock:
                    if not self.ystore.started.is_set():
                        self.create_task(self.ystore.start())
                        await self.ystore.started.wait()
                try:
                    await self.ystore.apply_updates(self.ydoc)
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
                    read_from_source = False
                except YDocNotFound:
                    # YDoc not found in the YStore, create the document from the source file (no change history)
                    pass

            if not read_from_source:
                # if YStore updates and source file are out-of-sync, resync updates with source
                if self._document.source != model["content"]:
                    # TODO: Delete document from the store.
                    self._emit(
                        LogLevel.INFO,
                        "initialize",
                        "The file is out-of-sync with the ystore.",
                    )
                    self.log.info(
                        "Content in file %s is out-of-sync with the ystore %s",
                        self._file.path,
                        self.ystore.__class__.__name__,
                    )
                    read_from_source = True

            if read_from_source:
                self._emit(LogLevel.INFO, "load", "Content loaded from disk.")
                self.log.info(
                    "Content in room %s loaded from file %s",
                    self._room_id,
                    self._file.path,
                )
                self._document.source = model["content"]

                if self.ystore:
                    await self.ystore.encode_state_as_update(self.ydoc)

            self._document.dirty = False
            self.ready = True
            self._emit(LogLevel.INFO, "initialize", "Room initialized")

    def _emit(self, level: LogLevel, action: str | None = None, msg: str | None = None) -> None:
        data = {"level": level.value, "room": self._room_id, "path": self._file.path}
        if action:
            data["action"] = action
        if msg:
            data["msg"] = msg

        self._logger.emit(schema_id=JUPYTER_COLLABORATION_EVENTS_URI, data=data)

    async def stop(self) -> None:
        """
        Stop the room.

        Cancels the save task and unsubscribes from the file.
        """
        try:
            await super().stop()
        except RuntimeError:
            pass
        # TODO: Should we cancel or wait ?
        if self._saving_document:
            self._saving_document.cancel()

        self._document.unobserve()
        self._file.unobserve(self.room_id)

    def create_task(self, aw):
        task = asyncio.create_task(aw)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def _broadcast_updates(self):
        # FIXME should be upstreamed
        try:
            await super()._broadcast_updates()
        except asyncio.CancelledError:
            pass

    async def _on_outofband_change(self) -> None:
        """
        Called when the file got out-of-band changes.
        """
        self.log.info("Out-of-band changes. Overwriting the content in room %s", self._room_id)
        self._emit(LogLevel.INFO, "overwrite", "Out-of-band changes. Overwriting the room.")

        try:
            model = await self._file.load_content(self._file_format, self._file_type)
        except Exception as e:
            msg = f"Error loading content from file: {self._file.path}\n{e!r}"
            self.log.error(msg, exc_info=e)
            self._emit(LogLevel.ERROR, None, msg)
            return

        async with self._update_lock:
            self._document.source = model["content"]
            self._document.dirty = False

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

        self._saving_document = asyncio.create_task(
            self._maybe_save_document(self._saving_document)
        )

    async def _maybe_save_document(self, saving_document: asyncio.Task | None) -> None:
        """
        Saves the content of the document to disk.

        ### Note:
            There is a save delay to debounce the save since we could receive a high
            amount of changes in a short period of time. This way we can cancel the
            previous save.
        """
        if self._save_delay is None:
            return

        if saving_document is not None and not saving_document.done():
            # the document is being saved, cancel that
            saving_document.cancel()

        # all async code (i.e. await statements) must be part of this try/except block
        # because this coroutine is run in a cancellable task and cancellation is handled here

        try:
            # save after X seconds of inactivity
            await asyncio.sleep(self._save_delay)

            self.log.info("Saving the content from room %s", self._room_id)
            await self._file.maybe_save_content(
                {
                    "format": self._file_format,
                    "type": self._file_type,
                    "content": self._document.source,
                }
            )
            async with self._update_lock:
                self._document.dirty = False

            self._emit(LogLevel.INFO, "save", "Content saved.")

        except asyncio.CancelledError:
            return

        except OutOfBandChanges:
            self.log.info("Out-of-band changes. Overwriting the content in room %s", self._room_id)
            try:
                model = await self._file.load_content(self._file_format, self._file_type)
            except Exception as e:
                msg = f"Error loading content from file: {self._file.path}\n{e!r}"
                self.log.error(msg, exc_info=e)
                self._emit(LogLevel.ERROR, None, msg)
                return None

            async with self._update_lock:
                self._document.source = model["content"]
                self._document.dirty = False

            self._emit(LogLevel.INFO, "overwrite", "Out-of-band changes while saving.")

        except Exception as e:
            msg = f"Error saving file: {self._file.path}\n{e!r}"
            self.log.error(msg, exc_info=e)
            self._emit(LogLevel.ERROR, None, msg)


class TransientRoom(YRoom):
    """A Y room for sharing state (e.g. awareness)."""

    def __init__(
        self,
        room_id: str,
        log: Logger | None = None,
        exception_handler: Callable[[Exception, Logger], bool] | None = None,
    ):
        super().__init__(log=log, exception_handler=exception_handler)

        self._room_id = room_id

    @property
    def room_id(self) -> str:
        """
        The room ID.
        """
        return self._room_id

    async def _broadcast_updates(self):
        # FIXME should be upstreamed
        try:
            await super()._broadcast_updates()
        except asyncio.CancelledError:
            pass

    async def stop(self) -> None:
        """
        Stop the room.
        """
        try:
            await super().stop()
        except RuntimeError:
            pass

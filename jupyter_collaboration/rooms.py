from __future__ import annotations

import asyncio
from logging import Logger
from typing import Any

from jupyter_ydoc import ydocs as YDOCS
from ypy_websocket.websocket_server import YRoom
from ypy_websocket.ystore import BaseYStore, YDocNotFound

from .loaders import FileLoader, OutOfBandChanges

YFILE = YDOCS["file"]


class DocumentRoom(YRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    def __init__(
        self,
        room_id: str,
        file_format: str,
        file_type: str,
        file: FileLoader,
        ystore: BaseYStore | None,
        log: Logger | None,
        save_delay: int | None = None,
    ):
        super().__init__(ready=False, ystore=ystore, log=log)

        self._room_id: str = room_id
        self._file_format: str = file_format
        self._file_type: str = file_type
        self._last_modified: Any = None
        self._file: FileLoader = file
        self._document = YDOCS.get(self._file_type, YFILE)(self.ydoc)

        self._save_delay = save_delay

        self._update_lock = asyncio.Lock()
        self._initialization_lock = asyncio.Lock()
        self._cleaner: asyncio.Task | None = None
        self._saving_document: asyncio.Task | None = None

        # Listen for document changes
        self._document.observe(self._on_document_change)
        self._file.observe(self.room_id, self._on_content_change)

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
        async with self._initialization_lock:
            if self.ready:  # type: ignore[has-type]
                return

            self.log.info("Initializing room %s", self._room_id)
            model = await self._file.load_content(self._file_format, self._file_type, True)

            async with self._update_lock:
                # try to apply Y updates from the YStore for this document
                read_from_source = True
                if self.ystore is not None:
                    try:
                        await self.ystore.apply_updates(self.ydoc)
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
                        self.log.info(
                            "Content in file %s is out-of-sync with the ystore %s",
                            self._file.path,
                            self.ystore.__class__.__name__,
                        )
                        read_from_source = True

                if read_from_source:
                    self.log.info(
                        "Content in room %s loaded from file %s", self._room_id, self._file.path
                    )
                    self._document.source = model["content"]

                    if self.ystore:
                        await self.ystore.encode_state_as_update(self.ydoc)

                self._last_modified = model["last_modified"]
                self._document.dirty = False
                self.ready = True

    def _clean(self) -> None:
        """
        Cleans the rooms.

        Cancels the save task and unsubscribes from the file.
        """
        super()._clean()
        # TODO: Should we cancel or wait ?
        if self._saving_document:
            self._saving_document.cancel()

        self._document.unobserve()
        self._file.unobserve(self.room_id)

    async def _on_content_change(self, event: str, args: dict[str, Any]) -> None:
        """
        Called when the file changes.

            Parameters:
                event (str): Type of change.
                args (dict): A dictionary with format, type, last_modified.
        """
        if event == "metadata" and self._last_modified < args["last_modified"]:
            model = await self._file.load_content(self._file_format, self._file_type, True)

            self.log.info("Out-of-band changes. Overwriting the content in room %s", self._room_id)

            async with self._update_lock:
                self._document.source = model["content"]
                self._last_modified = model["last_modified"]
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

        if self._saving_document is not None and not self._saving_document.done():
            # the document is being saved, cancel that
            self._saving_document.cancel()
            self._saving_document = None

        self._saving_document = asyncio.create_task(self._maybe_save_document())

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

        try:
            self.log.info("Saving the content from room %s", self._room_id)
            model = await self._file.save_content(
                {
                    "format": self._file_format,
                    "type": self._file_type,
                    "last_modified": self._last_modified,
                    "content": self._document.source,
                }
            )
            self._last_modified = model["last_modified"]
            async with self._update_lock:
                self._document.dirty = False

        except OutOfBandChanges:
            self.log.info("Out-of-band changes. Overwriting the content in room %s", self._room_id)
            model = await self._file.load_content(self._file_format, self._file_type, True)
            async with self._update_lock:
                self._document.source = model["content"]
                self._last_modified = model["last_modified"]
                self._document.dirty = False


class TransientRoom(YRoom):
    """A Y room for sharing state (e.g. awareness)."""

    def __init__(self, room_id: str, log: Logger | None):
        super().__init__(log=log)

        self._room_id = room_id

    @property
    def room_id(self) -> str:
        """
        The room ID.
        """
        return self._room_id

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from logging import Logger
from typing import Any

from jupyter_events import EventLogger
from jupyter_ydoc import ydocs as YDOCS
from pycrdt import (
    Channel,
    Doc,
    Encoder,
)
from pycrdt.store import BaseYStore, YDocNotFound
from pycrdt.websocket import YRoom

from .loaders import FileLoader
from .sessions import DocumentSessionStore
from .utils import JUPYTER_COLLABORATION_EVENTS_URI, LogLevel, MessageType, OutOfBandChanges

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
        document_load_progressively: bool = False,
        notebook_output_delay_threshold_mb: float | None = 100,
        exception_handler: Callable[[Exception, Logger], bool] | None = None,
        session_store: DocumentSessionStore | None = None,
    ):
        super().__init__(ready=False, ystore=ystore, exception_handler=exception_handler, log=log)

        self._room_id: str = room_id
        self._file_format: str = file_format
        self._file_type: str = file_type
        self._file: FileLoader = file
        self._document = YDOCS.get(self._file_type, YFILE)(self.ydoc, self.awareness)
        self._document.path = self._file.path

        self._logger = logger
        self._save_delay = save_delay
        self._document_load_progressively = document_load_progressively
        self._notebook_output_delay_threshold_mb = notebook_output_delay_threshold_mb
        if (
            document_load_progressively
            and notebook_output_delay_threshold_mb is not None
            and notebook_output_delay_threshold_mb < 0
        ):
            raise ValueError("notebook_output_delay_threshold_mb must be >=0 or None")

        self._session_store = session_store if session_store is not None else DocumentSessionStore()
        self.session_id: str | None = None

        self._update_lock = asyncio.Lock()
        self._cleaner: asyncio.Task | None = None
        self._saving_document: asyncio.Task | None = None
        self._messages: dict[str, asyncio.Lock] = {}
        self._background_tasks = set()
        self._document_progressively_loaded: asyncio.Future[None] = asyncio.Future()

        # Listen for document changes
        self._document.observe(self._on_document_change)
        self._file.observe(self.room_id, self._on_outofband_change, self._on_filepath_change)

        self.on_message_error = self._handle_sync_message_error

    @property
    def file_format(self) -> str:
        """Document file format."""
        return self._file_format

    @property
    def file_type(self) -> str:
        """Document file type."""
        return self._file_type

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
        if self.ready:
            return

        self.log.info("Initializing room %s", self._room_id)

        model = await self._file.load_content(self._file_format, self._file_type)

        await self._update_lock.acquire()
        release_update_lock = True
        try:
            # try to apply Y updates from the YStore for this document
            read_from_source = True
            loaded_from_store = False
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
                        f"Content loaded from the store {self.ystore.__class__.__qualname__}",
                    )
                    self.log.info(
                        "Content in room %s loaded from the ystore %s",
                        self._room_id,
                        self.ystore.__class__.__name__,
                    )
                    read_from_source = False
                    loaded_from_store = True
                except YDocNotFound:
                    # YDoc not found in the YStore, create the document from
                    # the source file (no change history)
                    pass

            if not read_from_source:
                # if YStore updates and source file are out-of-sync, resync updates with source
                if await self._document.aget() != model["content"]:
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

            # The document session must be assigned before the room is marked
            # ready (including the progressive-loading early return below) so
            # that the websocket handler can validate client claims against it
            # before serving any Yjs synchronization.
            self._assign_session(loaded_from_store)

            if read_from_source:
                self._emit(LogLevel.INFO, "load", "Content loaded from disk.")
                self.log.info(
                    "Content in room %s loaded from file %s",
                    self._room_id,
                    self._file.path,
                )
                if not loaded_from_store:
                    if self._document_load_progressively:
                        release_update_lock = False
                        initialized = asyncio.Event()
                        finish = asyncio.Event()
                        self.create_task(
                            self._finish_progressive_initialization(
                                model["content"], initialized, finish
                            )
                        )
                        await initialized.wait()
                        if (
                            self._document_progressively_loaded.done()
                            and (exc := self._document_progressively_loaded.exception()) is not None
                        ):
                            raise exc
                        self._publish_loaded_hash(model)
                        self.ready = True
                        await self.ydoc_observed.wait()
                        finish.set()
                        self._emit(LogLevel.INFO, "initialize", "Room initialized")
                        return
                    else:
                        await self._apply_source_content(model["content"])
                else:
                    await self._document.aset(model["content"])

                if self.ystore:
                    await self.ystore.encode_state_as_update(self.ydoc)

            self._publish_loaded_hash(model)
            self.ready = True
            self._emit(LogLevel.INFO, "initialize", "Room initialized")
        finally:
            if release_update_lock:
                self._update_lock.release()

    def _publish_loaded_hash(self, model: dict[str, Any]) -> None:
        """Publish the hash of the file content the room was loaded with.

            Parameters:
                model (dict): The content model the room loaded.

        ### Note:
            Without this a document only ever carries a hash once *this*
            room incarnation saved it, and a client reconciling a diverged
            session cannot prove that the file is unchanged since a known
            save - it would have to treat its own unsaved edits as a
            conflict and prompt the user for nothing.
        """
        file_hash = model.get("hash")
        if file_hash and self._document.hash != file_hash:
            self._document.hash = file_hash

    async def _finish_progressive_initialization(
        self, content: Any, initialized: asyncio.Event, finish: asyncio.Event
    ) -> None:
        try:
            await self._apply_source_content(
                content, progressive=True, initialized=initialized, finish=finish
            )
            if self.ystore:
                await self.ystore.encode_state_as_update(self.ydoc)
        except Exception as e:
            msg = f"Error loading content from file: {self._file.path}\n{e!r}"
            self.log.error(msg, exc_info=e)
            self._emit(LogLevel.ERROR, None, msg)
            self._document_progressively_loaded.set_exception(e)
        else:
            self._document_progressively_loaded.set_result(None)
            if await self._document.aget() != content:
                # that means there were user changes while progressively loading, save the document
                self._saving_document = asyncio.create_task(
                    self._maybe_save_document(self._saving_document, save_now=True)
                )
        finally:
            self._update_lock.release()

    def _assign_session(self, loaded_from_store: bool) -> None:
        """Assign the document session ID for this room incarnation.

            Parameters:
                loaded_from_store (bool): Whether the Yjs history was
                    restored from the YStore.

        ### Note:
            The session identifies one Yjs history lineage, and there are
            exactly two ways a room comes to hold one:

            - restored from the YStore, which continues the lineage the
              clients already hold, so the session is kept;
            - rebuilt from the source file, which creates brand new Yjs
              items under a fresh client id (see
              ``_apply_source_content``) and therefore a new lineage, so
              the session rolls. Clients holding the old one reconcile
              their content before resynchronizing.

            A rebuild always rolls, even when the file did not change: the
            items it produces are new regardless, and pretending otherwise
            is what makes tombstoning content unsafe.
        """
        store = self._session_store
        session = store.get(self._room_id)
        if loaded_from_store:
            if session is not None:
                # Downgrade a "rest" origin: the session now covers history.
                self.session_id = store.update(self._room_id, "store")
            elif carried := self._carried_session_id():
                # The session store was lost (deleted, or never writable)
                # but the history was not. Recover the identity the history
                # carries instead of declaring a new lineage: the restored
                # items are the very ones connected clients hold, so
                # refusing them would have them tombstone content that is
                # still live, deleting it for everyone.
                self.session_id = store.adopt(self._room_id, carried, "store")
                self.log.info(
                    "Recovered document session %s of room %s from its restored history",
                    self.session_id,
                    self._room_id,
                )
            else:
                self.session_id = store.roll(self._room_id, "store")
            self._publish_session_id()
            return

        # Rebuilt from the source file: new items, hence a new lineage.
        if session is not None and session.origin == "rest":
            # No Yjs history ever existed under this session: it was minted
            # by the REST handler for a client which has nothing to protect
            # yet, so it can cover this first rebuild instead of costing that
            # client a refusal round trip on the very first open.
            self.session_id = store.update(self._room_id, "rebuild")
        else:
            self.session_id = store.roll(self._room_id, "rebuild")
            self.log.info(
                "Room %s rebuilt from disk; new document session %s",
                self._room_id,
                self.session_id,
            )
        self._publish_session_id()

    def _carried_session_id(self) -> str | None:
        """The document session recorded in the restored Yjs history, if any.

        Returns:
            session_id (str | None): The session the restored history
                belongs to.
        """
        carried = self._document.ystate.get("document_session")
        return carried if isinstance(carried, str) and carried else None

    def _publish_session_id(self) -> None:
        """Record the session in the document, so the history carries it.

        ### Note:
            The session store is a convenience: it is fast to read and
            survives the document being evicted. The document itself is the
            authority, because the identity of a history lineage has to
            travel with that lineage - losing the store must not make a
            restored history look like a new one (see ``_assign_session``).
        """
        if self.session_id and self._carried_session_id() != self.session_id:
            self._document.ystate["document_session"] = self.session_id

    async def _apply_source_content(
        self,
        content: Any,
        progressive: bool = False,
        initialized: asyncio.Event | None = None,
        finish: asyncio.Event | None = None,
    ) -> None:
        """Build the room's Yjs items from the content of the source file.

            Parameters:
                content (Any): The document content to load.
                progressive (bool): Whether to stream the content in.
                initialized (asyncio.Event | None): Set once the document
                    structure is in place, for progressive loading.
                finish (asyncio.Event | None): Awaited before the remaining
                    content is streamed, for progressive loading.

        ### Note:
            The items are built in a throwaway document with an ordinary
            random client id, so a rebuild always produces a *new* Yjs
            history lineage rather than pretending to continue an existing
            one. Clients holding the previous lineage are told so by their
            document session being refused, and reconcile their content
            before resynchronizing (see ``_assign_session``).
        """
        source_ydoc: Doc = Doc()
        source_document = YDOCS.get(self._file_type, YFILE)(source_ydoc)
        if progressive:
            subscription = source_ydoc.observe(lambda event: self.ydoc.apply_update(event.update))
            try:
                await source_document.aset_progressively(
                    content,
                    initialized=initialized,
                    finish=finish,
                    delay_outputs_above_mb=self._notebook_output_delay_threshold_mb,
                )
            finally:
                source_ydoc.unobserve(subscription)
        else:
            await source_document.aset(content)
            self.ydoc.apply_update(source_ydoc.get_update())

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

    async def _handle_sync_message_error(
        self, exc: Exception, message: bytes, channel: Channel
    ) -> bool:
        """Handle errors raised by handle_sync_message.

        Intercepts InvalidParent conflicts caused by a stale client reconnecting
        after the room was evicted and rebuilt from a modified file. Sends a RAW
        conflict notification so the client can offer a resolution dialog, and
        returns True so the serve loop continues for the remaining clients.
        """
        if not message or message[0] != MessageType.SYNC:
            return False
        if not (isinstance(exc, RuntimeError) and "block parent" in str(exc)):
            return False
        self.log.warning(
            "Conflict in room %s from %s: %s",
            self._room_id,
            channel.path,
            exc,
        )
        encoder = Encoder()
        encoder.write_var_uint(MessageType.RAW)
        encoder.write_var_string(json.dumps({"type": "conflict"}))
        await channel.send(encoder.to_bytes())
        return True

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

        await self._adopt_file_content(model)

    async def _adopt_file_content(self, model: dict[str, Any]) -> None:
        """Take the content the file now holds into the room.

            Parameters:
                model (dict): The content model loaded from the file.

        ### Note:
            Reached both from the file watcher and from a save which found
            the file changed underneath it; both leave the lineage holding
            content it was not founded with, and both have to publish the
            new hash so clients keep being able to tell an out-of-band
            change from their own unsaved edits.
        """
        async with self._update_lock:
            if await self._document.aget() != model["content"]:
                await self._document.aset(model["content"])
            self._document.dirty = False
            self._publish_loaded_hash(model)

    def _on_filepath_change(self) -> None:
        """
        Update the document path property.
        """
        self._document.path = self._file.path

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
        # Collect autosave values from all clients
        autosave_states = [
            state.get("autosave", True)
            for state in self.awareness.states.values()
            if state  # skip empty states
        ]

        # If no states exist (e.g., during tests), force autosave to be True
        if not autosave_states:
            autosave_states = [True]

        # Enable autosave if at least one client has it turned on
        autosave = any(autosave_states)

        if not autosave:
            return
        if self._update_lock.locked():
            return

        self._saving_document = asyncio.create_task(
            self._maybe_save_document(self._saving_document)
        )

    def _save_to_disc(self):
        """
        Called when manual save is triggered. Helpful when autosave is turned off.
        """
        if self._update_lock.locked():
            return

        self._saving_document = asyncio.create_task(
            self._maybe_save_document(self._saving_document, save_now=True)
        )
        return self._saving_document

    async def _maybe_save_document(
        self, saving_document: asyncio.Task | None, save_now: bool = False
    ) -> None:
        """
        Saves the content of the document to disk.

        ### Note:
            There is a save delay to debounce the save since we could receive a high
            amount of changes in a short period of time. This way we can cancel the
            previous save. When save_now is True, the delay is skipped and the save
            executes immediately.

            Parameters:
                saving_document: The previous saving task to cancel if needed.
                save_now: If True, skip the debounce delay, and save immediately.
                          This is used when manually saving.
        """
        if self._save_delay is None and not save_now:
            return
        if saving_document is not None and not saving_document.done():
            # the document is being saved, cancel that
            saving_document.cancel()

        # all async code (i.e. await statements) must be part of this try/except block
        # because this coroutine is run in a cancellable task and cancellation is handled here

        try:
            # When save_now is False, wait X seconds of inactivity before saving (auto-save).
            # When save_now is True, save immediately without debounce delay (manual save).
            if not save_now and self._save_delay is not None:
                await asyncio.sleep(self._save_delay)

            self.log.info("Saving the content from room %s", self._room_id)
            content = await self._document.aget()
            saved_model = await self._file.maybe_save_content(
                {
                    "format": self._file_format,
                    "type": self._file_type,
                    "content": content,
                }
            )
            if saved_model:
                async with self._update_lock:
                    self._document.dirty = False
                    self._document.hash = saved_model["hash"]

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

            await self._adopt_file_content(model)
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

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from logging import Logger
from typing import Any

from jupyter_events import EventLogger
from jupyter_ydoc import YNotebook
from jupyter_ydoc import ydocs as YDOCS
from pycrdt import (
    Assoc,
    Channel,
    Decoder,
    Doc,
    Encoder,
)
from pycrdt.store import BaseYStore, YDocNotFound
from pycrdt.websocket import YRoom

from .loaders import FileLoader
from .utils import JUPYTER_COLLABORATION_EVENTS_URI, LogLevel, MessageType, OutOfBandChanges

YFILE = YDOCS["file"]


class DocumentRoom(YRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    _background_tasks: set[asyncio.Task]

    # Deterministic rebuilds author content under a "marked" Yjs client id
    # (>= this value). Real collaborative clients are y-websocket/Yjs, which use
    # uint32 client ids (< 2^32), so any author id below the marker denotes a
    # genuine client edit. The marker stays well under 2^53 so the id round-trips
    # through Yjs (which requires JSON-safe integers).
    _REBUILD_CLIENT_MARKER = 1 << 47

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
        self._document = YDOCS.get(self._file_type, YFILE)(self.ydoc, self.awareness)
        self._document.path = self._file.path

        self._logger = logger
        self._save_delay = save_delay

        self._update_lock = asyncio.Lock()
        self._cleaner: asyncio.Task | None = None
        self._saving_document: asyncio.Task | None = None
        self._messages: dict[str, asyncio.Lock] = {}
        self._background_tasks = set()
        self._deduplicating = False
        # Client id used by the most recent deterministic rebuild from disk; lets
        # the dedup logic recognise the authoritative on-disk copy of a cell.
        self._rebuild_client_id: int | None = None

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

        async with self._update_lock:
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

            if read_from_source:
                self._emit(LogLevel.INFO, "load", "Content loaded from disk.")
                self.log.info(
                    "Content in room %s loaded from file %s",
                    self._room_id,
                    self._file.path,
                )
                if not loaded_from_store:
                    await self._apply_deterministic_source_content(model["content"])
                else:
                    await self._document.aset(model["content"])

                if self.ystore:
                    await self.ystore.encode_state_as_update(self.ydoc)

            self._document.dirty = False
            self.ready = True
            self._emit(LogLevel.INFO, "initialize", "Room initialized")

    @classmethod
    def _content_client_id(cls, content: Any) -> int:
        """A deterministic, content-derived Yjs client id for a rebuild.

        Identical content always yields the same id, so rebuilding an unchanged
        document from disk reproduces the same Yjs history (a reconnecting client
        sees no duplication). Crucially, *different* content yields a *different*
        id: the new content then occupies coordinates a stale client lacks, so it
        actually reaches the client instead of silently colliding with the old
        content at the same (client_id, clock), which is what caused the "cell
        reverts to a previous version" bug. The id is marked
        (>= _REBUILD_CLIENT_MARKER) so it is distinguishable from real Yjs client ids.
        """
        digest = hashlib.sha256(
            json.dumps(content, sort_keys=True, default=str).encode("utf-8")
        ).digest()
        marker = cls._REBUILD_CLIENT_MARKER
        return (int.from_bytes(digest[:6], "big") & (marker - 1)) | marker

    async def _apply_deterministic_source_content(self, content: Any) -> None:
        """Load source content using a deterministic, content-addressed update.

        Rooms rebuilt from disk must recreate the same Yjs history for identical
        content, otherwise reconnecting clients can merge duplicate content from a
        divergent history after server restart or room eviction.

        The client id is derived from the content (see _content_client_id) rather
        than fixed to 0: a fixed id makes *changed* content reuse the same
        (client_id, clock) coordinates a stale client still holds for the old
        content, so state-vector sync delivers nothing and the client silently
        stays on the previous version. A content-addressed id keeps the
        unchanged-content idempotency while letting changed content reach the
        client (resolved afterwards by _deduplicate_cells).
        See https://discuss.yjs.dev/t/initial-offline-value-of-a-shared-document/465
        """
        client_id = self._content_client_id(content)
        self._rebuild_client_id = client_id
        source_ydoc: Doc = Doc(client_id=client_id)
        source_document = YDOCS.get(self._file_type, YFILE)(source_ydoc)
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
        await channel.send(self._conflict_message())
        return True

    @staticmethod
    def _conflict_message() -> bytes:
        """Build a RAW conflict notification for the frontend resolution dialog."""
        encoder = Encoder()
        encoder.write_var_uint(MessageType.RAW)
        encoder.write_var_string(json.dumps({"type": "conflict"}))
        return encoder.to_bytes()

    async def _broadcast_conflict(self) -> None:
        """Send a RAW conflict notification to all connected clients."""
        message = self._conflict_message()
        for client in list(self.clients):
            try:
                await client.send(message)
            except Exception as exc:  # noqa: BLE001
                self.log.warning("Failed to send conflict notification to %s: %s", client.path, exc)

    def _has_duplicate_cell_ids(self) -> bool:
        """Cheaply check whether any cell ID appears more than once.

        Reads only the ``id`` of each cell (no full conversion), so it is safe
        to run on every cell change; the expensive content comparison in
        _deduplicate_cells only runs when this returns True.
        """
        if not isinstance(self._document, YNotebook):
            return False
        seen: set[str] = set()
        ycells = self._document.ycells
        for index in range(len(ycells)):
            cell_id = ycells[index].get("id")
            if cell_id is None:
                continue
            if cell_id in seen:
                return True
            seen.add(cell_id)
        return False

    def _maybe_deduplicate_cells(self) -> None:
        """Schedule duplicate-cell repair when duplicate cell IDs are present.

        Duplicate cell IDs appear when a client that edited the document during
        a session reconnects after the room was rebuilt deterministically
        (client_id=0) from disk: the same cells then exist both under
        client_id=0 and under the client's own id, and the reconnect sync
        appends the client's copies next to the rebuilt ones.

        Repair must run outside the observer (mutating the document inside a
        change callback raises "read-only transaction"), so it is deferred to a
        background task, mirroring the autosave scheduling.
        """
        if self._deduplicating or self._update_lock.locked():
            return
        if not self._has_duplicate_cell_ids():
            return
        self._deduplicating = True
        self.create_task(self._deduplicate_cells())

    def _cell_client_ids(self, count: int) -> list[int | None]:
        """Return the originating Yjs client id of each cell, by index.

        A deterministic rebuild from disk authors its cells under the content
        derived ``self._rebuild_client_id`` (see _content_client_id), so a cell
        whose id equals that value is the authoritative on-disk copy, while a
        reconnecting client's stale cell carries a different (earlier rebuild's)
        client id.
        """
        client_ids: list[int | None] = []
        with self._document.ydoc.transaction():
            for index in range(count):
                sticky = self._document.ycells.sticky_index(index, Assoc.AFTER)
                item = sticky.to_json().get("item") if sticky is not None else None
                client_ids.append(item.get("client") if item else None)
        return client_ids

    def _doc_has_client_edits(self) -> bool:
        """Whether any real collaborative client authored content in the room.

        Deterministic rebuilds author cells under a marked client id
        (>= _REBUILD_CLIENT_MARKER); Yjs clients use uint32 ids (< 2^32). So an
        authoring client id below the marker (other than the room's own doc id,
        used only for server-side housekeeping such as dedup deletions) means a
        genuine client edit is present, which must never be silently discarded.

        Read from the document state vector, which lists every client that has
        inserted content. If it cannot be decoded we assume edits exist, so the
        conservative branch keeps the client's copy.
        """
        doc = self._document.ydoc
        try:
            decoder = Decoder(doc.get_state())
            num_clients = decoder.read_var_uint()
            own = doc.client_id
            for _ in range(num_clients):
                client = decoder.read_var_uint()
                decoder.read_var_uint()  # clock (unused)
                if client < self._REBUILD_CLIENT_MARKER and client != own:
                    return True
        except Exception:  # noqa: BLE001
            return True
        return False

    async def _deduplicate_cells(self) -> None:
        """Repair duplicate cells produced when a stale client reconnects.

        Duplicates arise when the room is rebuilt from disk (content-addressed
        client id) and a reconnecting client still holds an earlier copy of a
        cell under a different rebuild id. Cells are grouped by id and resolved:

        * Exact duplicates (identical content) collapse to one copy, preferring
          the authoritative on-disk copy. No conflict.
        * Divergent copies where the client made NO edits (a purely stale cache
          of an older on-disk version): adopt the authoritative on-disk copy and
          drop the stale one. No conflict; the client simply catches up.
        * Divergent copies where the client DID edit (or the on-disk copy cannot
          be identified): keep the client's copy and surface a conflict, so the
          user's in-memory edits are never silently discarded (Revert restores
          the on-disk version).
        """
        has_conflict = False
        try:
            async with self._update_lock:
                cells = self._document.get(deduplicate=False)["cells"]
                client_ids = self._cell_client_ids(len(cells))
                client_edited = self._doc_has_client_edits()
                rebuild_id = self._rebuild_client_id

                groups: dict[str, list[int]] = {}
                for index, cell in enumerate(cells):
                    cell_id = cell.get("id")
                    if cell_id is not None:
                        groups.setdefault(cell_id, []).append(index)

                to_delete: list[int] = []
                for indices in groups.values():
                    if len(indices) < 2:
                        continue
                    disk = [i for i in indices if client_ids[i] == rebuild_id]
                    first = cells[indices[0]]
                    if all(cells[i] == first for i in indices[1:]):
                        # Identical content: keep one copy (prefer the on-disk one).
                        keep = disk[0] if disk else indices[0]
                        to_delete.extend(i for i in indices if i != keep)
                    elif disk and not client_edited:
                        # Purely stale cache: adopt the authoritative on-disk copy.
                        keep = disk[0]
                        to_delete.extend(i for i in indices if i != keep)
                    else:
                        # Client edits diverge from disk (or no on-disk copy):
                        # keep the client's copy and surface a conflict.
                        client_copies = [i for i in indices if i not in disk]
                        keep = client_copies[0] if client_copies else indices[0]
                        to_delete.extend(i for i in indices if i != keep)
                        has_conflict = True

                if to_delete:
                    with self._document.ydoc.transaction():
                        for index in sorted(set(to_delete), reverse=True):
                            del self._document.ycells[index]
                    self.log.warning(
                        "Resolved %d duplicate cell(s) in room %s after a "
                        "stale-client reconnect",
                        len(to_delete),
                        self._room_id,
                    )
                    self._emit(
                        LogLevel.WARNING,
                        "deduplicate",
                        f"Resolved {len(to_delete)} duplicate cell(s).",
                    )
        finally:
            self._deduplicating = False

        if has_conflict:
            self.log.warning(
                "Divergent cell edits in room %s; surfacing conflict",
                self._room_id,
            )
            await self._broadcast_conflict()

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
            if await self._document.aget() != model["content"]:
                await self._document.aset(model["content"])
            self._document.dirty = False

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
        # Repair duplicate cells from a divergent-history merge (e.g. a client
        # reconnecting after a deterministic room rebuild).
        if target == "cells":
            self._maybe_deduplicate_cells()

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
            saved_model = await self._file.maybe_save_content(
                {
                    "format": self._file_format,
                    "type": self._file_type,
                    "content": await self._document.aget(),
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

            async with self._update_lock:
                if await self._document.aget() != model["content"]:
                    await self._document.aset(model["content"])
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

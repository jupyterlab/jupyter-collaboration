# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from copy import deepcopy
from importlib.metadata import entry_points

import pytest
from anyio import Event, create_task_group, fail_after, sleep
from jupyter_server_ydoc.loaders import FileLoader
from jupyter_server_ydoc.rooms import DocumentRoom
from jupyter_server_ydoc.test_utils import FakeContentsManager, FakeEventLogger, FakeFileIDManager
from jupyter_server_ydoc.utils import MessageType
from jupyter_ydoc import YNotebook
from pycrdt import Channel, Doc, Provider, YMessageType, YSyncMessageType, write_message
from pycrdt.store import SQLiteYStore
from pycrdt.websocket.websocket import HttpxWebsocket

jupyter_ydocs = {ep.name: ep.load() for ep in entry_points(group="jupyter_ydoc")}


class _SingleMessageChannel:
    """Mock channel that delivers one message to the room then stops iteration."""

    def __init__(self, message: bytes) -> None:
        self._message = message
        self._sent: list[bytes] = []
        self._iter_done = False

    @property
    def path(self) -> str:
        return "mock://test"

    def __aiter__(self) -> Channel:
        return self

    async def __anext__(self) -> bytes:
        if self._iter_done:
            raise StopAsyncIteration
        self._iter_done = True
        return self._message

    async def send(self, message: bytes) -> None:
        self._sent.append(message)

    async def recv(self) -> bytes:
        raise StopAsyncIteration


@pytest.fixture
def rtc_document_save_delay():
    return 0.5


async def test_dirty(
    rtc_create_file,
    rtc_connect_doc_client,
    rtc_document_save_delay,
):
    file_format = "text"
    file_type = "file"
    file_path = "dummy.txt"
    await rtc_create_file(file_path, "original")
    jupyter_ydoc = jupyter_ydocs[file_type]()

    websocket, room_name = await rtc_connect_doc_client(file_format, file_type, file_path)
    async with websocket as ws, Provider(jupyter_ydoc.ydoc, HttpxWebsocket(ws, room_name)):
        with fail_after(15):
            # Wait for initial synchronization before making an edit. Repeatedly
            # setting dirty can restart the server's autosave debounce timer.
            while jupyter_ydoc.source != "original":
                await sleep(0.01)
            jupyter_ydoc.dirty = True
            jupyter_ydoc.source = "edited"
            while jupyter_ydoc.dirty:
                await sleep(0.01)


async def cleanup(jp_serverapp):
    # workaround for a shutdown issue of aiosqlite, see
    # https://github.com/jupyterlab/jupyter-collaboration/issues/252
    await jp_serverapp.web_app.settings["jupyter_server_ydoc"].stop_extension()
    # workaround `jupyter_server_fileid` manager accessing database on GC
    del jp_serverapp.web_app.settings["file_id_manager"]


async def test_room_concurrent_initialization(
    jp_serverapp,
    rtc_create_file,
    rtc_connect_doc_client,
):
    file_format = "text"
    file_type = "file"
    file_path = "dummy.txt"
    await rtc_create_file(file_path, "original")
    server = jp_serverapp.web_app.settings["jupyter_server_ydoc"].ywebsocket_server
    rooms = []
    connected = Event()

    async def connect():
        websocket, room_name = await rtc_connect_doc_client(file_format, file_type, file_path)
        doc = jupyter_ydocs[file_type]()
        async with websocket as ws, Provider(doc.ydoc, HttpxWebsocket(ws, room_name)):
            while doc.source != "original":
                await sleep(0.01)
            rooms.append(server.rooms[room_name])
            if len(rooms) == 2:
                connected.set()
            await connected.wait()

    try:
        with fail_after(15):
            async with create_task_group() as tg:
                tg.start_soon(connect)
                tg.start_soon(connect)
        assert len(rooms) == 2
        assert rooms[0] is rooms[1]
        assert rooms[0].ready
    finally:
        await cleanup(jp_serverapp)


async def test_room_sequential_opening(
    jp_serverapp,
    rtc_create_file,
    rtc_connect_doc_client,
):
    file_format = "text"
    file_type = "file"
    file_path = "dummy.txt"
    await rtc_create_file(file_path, "original")
    server = jp_serverapp.web_app.settings["jupyter_server_ydoc"].ywebsocket_server

    async def connect(expected, edit=None):
        websocket, room_name = await rtc_connect_doc_client(file_format, file_type, file_path)
        doc = jupyter_ydocs[file_type]()
        async with websocket as ws, Provider(doc.ydoc, HttpxWebsocket(ws, room_name)):
            while doc.source != expected:
                await sleep(0.01)
            room = server.rooms[room_name]
            if edit is not None:
                doc.source = edit
                while room._document.source != edit:
                    await sleep(0.01)
            return room

    try:
        with fail_after(15):
            first = await connect("original", "edited")
            second = await connect("edited")
        assert first is second
    finally:
        await cleanup(jp_serverapp)


def _notebook_model() -> dict:
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {},
        "cells": [
            {
                "cell_type": "code",
                "id": "cell-1",
                "metadata": {},
                "source": "",
                "outputs": [],
                "execution_count": None,
            }
        ],
    }


async def _create_notebook_room(notebook: dict, room_id: str) -> tuple[DocumentRoom, FileLoader]:
    file_id = f"file-{room_id}"
    loader = FileLoader(
        file_id,
        FakeFileIDManager({file_id: "test.ipynb"}),
        FakeContentsManager({"content": deepcopy(notebook), "writable": True}),
    )
    room = DocumentRoom(
        room_id,
        "json",
        "notebook",
        loader,
        FakeEventLogger(),
        None,
        None,
        None,
        document_load_progressively=False,
    )
    await room.initialize()
    return room, loader


def _sync_documents(client_doc: YNotebook, room: DocumentRoom) -> dict:
    room.ydoc.apply_update(client_doc.ydoc.get_update())
    client_doc.ydoc.apply_update(room.ydoc.get_update())
    return client_doc.get(deduplicate=False)


async def test_notebook_reconnect_with_divergent_history_does_not_duplicate_initial_cell():
    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "divergent-history-before")
    client_doc = YNotebook()

    try:
        # Initial connection: client receives the original server-side history.
        client_doc.ydoc.apply_update(room.ydoc.get_update())
    finally:
        # Simulate the server losing in-memory state while the client keeps its local YDoc.
        await room.stop()
        await loader.clean()

    recreated_room, recreated_loader = await _create_notebook_room(
        notebook, "divergent-history-after"
    )
    try:
        merged = _sync_documents(client_doc, recreated_room)
    finally:
        await recreated_room.stop()
        await recreated_loader.clean()

    assert len(merged["cells"]) == 1


async def test_notebook_reconnect_sends_conflict_when_cell_structure_changes_between_restarts():
    """When cell structure changes between room restarts, serve() must not crash.

    _apply_deterministic_source_content uses Doc(client_id=0) so that Yjs item
    clocks are stable across room restarts for identical content.  That
    assumption breaks when the on-disk notebook changes structure between the
    client's last sync and the next room creation: adding a primitive value
    inside a cell (e.g. a kernel marks the cell trusted via
    {"metadata": {"trusted": True}}) inserts one extra ItemContent::Any before
    the source Text branch.  This shifts clock position 4 from
    ItemContent::Type (the source Text) in the original room to
    ItemContent::Any in the recreated room.

    A client that made local edits against the original layout holds a parent
    reference to (client_id=0, clock=4) which is no longer a valid container,
    so yrs raises "block parent <0#4> must be deleted or shared ref type.
    Type: 8" when that update is applied.

    The server must catch this, keep the room intact, and send a CONFLICT
    message back to the client so the frontend can offer Save As / View Diff.
    """
    notebook_before = _notebook_model()
    room_a, loader_a = await _create_notebook_room(notebook_before, "meta-change-before")
    client_doc = YNotebook()
    try:
        # Client connects to room A and receives all client_id=0 items.
        client_doc.ydoc.apply_update(room_a.ydoc.get_update())
        # Client edits the cell source, creating an item whose parent is the
        # source Text branch — a client_id=0 item at clock position 4.
        client_doc.ycells[0]["source"] += "new content"
    finally:
        await room_a.stop()
        await loader_a.clean()

    # Disk content changes: cell metadata gains "trusted": True.
    # _apply_deterministic_source_content will now allocate clock 4 to the
    # "trusted" Any value instead of the source Text branch.
    notebook_after = deepcopy(notebook_before)
    notebook_after["cells"][0]["metadata"] = {"trusted": True}
    room_b, loader_b = await _create_notebook_room(notebook_after, "meta-change-after")
    try:
        # Build a SYNC_UPDATE message carrying the client's conflicting edit.
        client_update = client_doc.ydoc.get_update()
        sync_update_msg = bytes([YMessageType.SYNC, YSyncMessageType.SYNC_UPDATE]) + write_message(
            client_update
        )
        channel = _SingleMessageChannel(sync_update_msg)

        # serve() must complete without raising even though apply_update would crash.
        await room_b.serve(channel)

        # The room must have sent at least a SYNC_STEP2 and a RAW conflict message.
        message_types = [msg[0] for msg in channel._sent]
        assert (
            MessageType.RAW in message_types
        ), f"Expected a RAW conflict message, got types: {message_types}"

        # The RAW conflict message encodes a JSON payload with type=conflict.
        conflict_msg = next(
            m for m in channel._sent if m[0] == MessageType.RAW and b'"type": "conflict"' in m
        )
        assert b'"type": "conflict"' in conflict_msg
        assert len(conflict_msg) > 1

        # The room itself must remain coherent — still one cell.
        server_notebook = YNotebook()
        server_notebook.ydoc.apply_update(room_b.ydoc.get_update())
        assert len(server_notebook.get(deduplicate=False)["cells"]) == 1
    finally:
        await room_b.stop()
        await loader_b.clean()


async def _create_notebook_room_with_store(
    notebook: dict, room_id: str, store_path: str, db_path: str
) -> tuple[DocumentRoom, FileLoader, SQLiteYStore]:
    file_id = f"file-{room_id}"
    loader = FileLoader(
        file_id,
        FakeFileIDManager({file_id: "test.ipynb"}),
        FakeContentsManager({"content": deepcopy(notebook), "writable": True}),
    )
    ystore = SQLiteYStore(path=store_path)
    ystore.db_path = db_path
    room = DocumentRoom(
        room_id,
        "json",
        "notebook",
        loader,
        FakeEventLogger(),
        ystore,
        None,
        None,
        document_load_progressively=False,
    )
    await room.initialize()
    return room, loader, ystore


async def _stop_room_and_store(room: DocumentRoom, ystore: SQLiteYStore) -> None:
    try:
        await room.stop()
    except RuntimeError:
        pass
    try:
        await ystore.stop()
    except RuntimeError:
        pass


def _document_session(room: DocumentRoom) -> str | None:
    return room._document.ystate.get("document_session")


async def test_document_session_is_assigned_on_fresh_room_creation():
    room, loader = await _create_notebook_room(_notebook_model(), "fresh-session")
    try:
        assert _document_session(room)
    finally:
        await room.stop()
        await loader.clean()


async def test_document_session_persists_across_store_backed_room_recreation(tmp_path):
    """A room rebuilt from a store that still holds its history is the same
    incarnation, so a reconnecting client's remembered session must still match."""
    db_path = str(tmp_path / "ystore.db")

    room_a, loader_a, ystore_a = await _create_notebook_room_with_store(
        _notebook_model(), "persist-before", "test.ipynb.y", db_path
    )
    session_a = _document_session(room_a)
    # Disk genuinely unchanged since room A's content was last established
    # (including whatever defaults YNotebook filled in), so the store restore
    # below finds no real mismatch and doesn't fall back to a fresh rebuild.
    content_on_disk = await room_a._document.aget()
    await _stop_room_and_store(room_a, ystore_a)
    await loader_a.clean()

    room_b, loader_b, ystore_b = await _create_notebook_room_with_store(
        content_on_disk, "persist-after", "test.ipynb.y", db_path
    )
    try:
        assert _document_session(room_b) == session_a
    finally:
        await _stop_room_and_store(room_b, ystore_b)
        await loader_b.clean()


async def test_override_content_rewrites_room_under_a_new_session(tmp_path):
    """A client choosing to keep its own version after a document_session
    mismatch pushes its content, which must land as a genuinely new
    incarnation (not a continuation of either side's prior history) and
    persist to disk."""
    room, loader = await _create_notebook_room(_notebook_model(), "override-target")
    try:
        session_before = _document_session(room)
        new_content = deepcopy(_notebook_model())
        new_content["cells"][0]["source"] = "overridden by client"

        new_session = await room.override_content(new_content)

        assert new_session != session_before
        assert _document_session(room) == new_session
        current = await room._document.aget()
        assert current["cells"][0]["source"] == "overridden by client"
        assert "save" in loader._contents_manager.actions
    finally:
        await room.stop()
        await loader.clean()


async def test_document_session_changes_after_genuine_rebuild_from_disk(tmp_path):
    """A room rebuilt with no store history for its path is a new incarnation
    with no relation to whatever a reconnecting client remembers."""
    notebook = _notebook_model()

    room_a, loader_a, ystore_a = await _create_notebook_room_with_store(
        notebook, "rebuild-before", "test.ipynb.y", str(tmp_path / "ystore-a.db")
    )
    session_a = _document_session(room_a)
    await _stop_room_and_store(room_a, ystore_a)
    await loader_a.clean()

    # A different store (empty for this path) simulates a genuine YDocNotFound:
    # a deleted/lost store, a rekeyed file id, or simply the first rebuild this
    # document has ever had under this mechanism.
    room_b, loader_b, ystore_b = await _create_notebook_room_with_store(
        notebook, "rebuild-after", "test.ipynb.y", str(tmp_path / "ystore-b.db")
    )
    try:
        assert _document_session(room_b) != session_a
    finally:
        await _stop_room_and_store(room_b, ystore_b)
        await loader_b.clean()


async def test_document_session_backfilled_when_restoring_history_with_none(tmp_path):
    """A room whose real history predates document_session existing (or whose
    own first genuine rebuild happened before the mechanism was active) gets a
    baseline session assigned on its next successful restore, rather than
    needing another full rebuild before it can be protected at all."""
    db_path = str(tmp_path / "ystore.db")
    store_path = "test.ipynb.y"
    notebook = _notebook_model()

    # Seed the store directly, bypassing DocumentRoom, to simulate real history
    # that was written before document_session existed at all. Disk content
    # matches the store's own round-tripped content exactly, so this only
    # exercises the clean-restore path -- not the mismatch/resync branch,
    # which is a separate concern tested below.
    seed_store = SQLiteYStore(path=store_path)
    seed_store.db_path = db_path
    disk_content = None
    async with create_task_group() as tg:
        await tg.start(seed_store.start)
        seed_doc = Doc()
        seed_notebook = YNotebook(seed_doc)
        await seed_notebook.aset(notebook)
        disk_content = await seed_notebook.aget()
        await seed_store.encode_state_as_update(seed_doc)
        await seed_store.stop()

    room, loader, ystore = await _create_notebook_room_with_store(
        disk_content, "backfill-before", store_path, db_path
    )
    session_after_backfill = None
    try:
        session_after_backfill = _document_session(room)
        assert session_after_backfill is not None
    finally:
        await _stop_room_and_store(room, ystore)
        await loader.clean()

    # Confirm it actually persisted -- not just held in this room's memory.
    room2, loader2, ystore2 = await _create_notebook_room_with_store(
        disk_content, "backfill-after", store_path, db_path
    )
    try:
        assert _document_session(room2) == session_after_backfill
    finally:
        await _stop_room_and_store(room2, ystore2)
        await loader2.clean()

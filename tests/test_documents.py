# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from collections.abc import Callable
from copy import deepcopy
from importlib.metadata import entry_points
from time import time

import pytest
from anyio import Event, create_task_group, sleep
from jupyter_server_ydoc.loaders import FileLoader
from jupyter_server_ydoc.rooms import DocumentRoom
from jupyter_server_ydoc.test_utils import FakeContentsManager, FakeEventLogger, FakeFileIDManager
from jupyter_server_ydoc.utils import MessageType
from jupyter_ydoc import YNotebook
from pycrdt import (
    Channel,
    Doc,
    Provider,
    YSyncMessageType,
    handle_sync_message,
)
from pycrdt.websocket.websocket import HttpxWebsocket

jupyter_ydocs = {ep.name: ep.load() for ep in entry_points(group="jupyter_ydoc")}


class _HandshakeChannel(Channel):
    """Mock channel that completes a server-initiated sync handshake.

    ``serve()`` first sends SYNC_STEP1 (the server's state vector); this channel
    captures it and replies, on its first iteration, with the client's
    SYNC_STEP2 (the update the client owes the server), exactly as a real client
    would. This is the realistic protocol path: unlike a full state exchange,
    a SYNC_STEP2 computed against the server's state vector only carries items
    the server's vector does not already cover.

    With ``stay_connected=True`` the channel keeps the serve() loop alive after
    replying (so the client remains in ``room.clients``) until ``disconnect()``
    is called. This is needed to observe messages the server broadcasts from a
    deferred task, such as the conflict notification raised by divergent cells.

    Only ``recv()``/``send()``/``path`` are defined; the async-iteration
    machinery is inherited from the ``Channel`` protocol (``__anext__`` calls
    ``recv()``).
    """

    def __init__(self, client_doc: YNotebook, *, stay_connected: bool = False) -> None:
        self._client_doc = client_doc
        self._sent: list[bytes] = []
        self._replied = False
        self._stay_connected = stay_connected
        self._disconnect = Event()

    @property
    def path(self) -> str:
        return "mock://client"

    async def recv(self) -> bytes:
        if not self._replied:
            self._replied = True
            # _sent[0] is the server's SYNC_STEP1, sent before the serve() loop.
            step2 = handle_sync_message(self._sent[0][1:], self._client_doc.ydoc)
            assert step2 is not None and step2[1] == YSyncMessageType.SYNC_STEP2
            return step2
        if self._stay_connected:
            await self._disconnect.wait()
        raise StopAsyncIteration

    async def send(self, message: bytes) -> None:
        self._sent.append(message)

    def disconnect(self) -> None:
        """Let the serve() loop exit on its next iteration."""
        self._disconnect.set()

    @property
    def received(self) -> list[bytes]:
        """Messages the server sent to this channel."""
        return self._sent


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
    await rtc_create_file(file_path)
    jupyter_ydoc = jupyter_ydocs[file_type]()

    websocket, room_name = await rtc_connect_doc_client(file_format, file_type, file_path)
    async with websocket as ws, Provider(jupyter_ydoc.ydoc, HttpxWebsocket(ws, room_name)):
        for _ in range(2):
            jupyter_ydoc.dirty = True
            await sleep(rtc_document_save_delay * 1.5)
            assert not jupyter_ydoc.dirty


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
    await rtc_create_file(file_path)

    async def connect(file_format, file_type, file_path):
        websocket, room_name = await rtc_connect_doc_client(file_format, file_type, file_path)
        async with websocket:
            pass

    t0 = time()
    async with create_task_group() as tg:
        tg.start_soon(connect, file_format, file_type, file_path)
        tg.start_soon(connect, file_format, file_type, file_path)
    t1 = time()
    delta = t1 - t0
    assert delta < 0.6

    await cleanup(jp_serverapp)


async def test_room_sequential_opening(
    jp_serverapp,
    rtc_create_file,
    rtc_connect_doc_client,
):
    file_format = "text"
    file_type = "file"
    file_path = "dummy.txt"
    await rtc_create_file(file_path)

    async def connect(file_format, file_type, file_path):
        t0 = time()
        websocket, room_name = await rtc_connect_doc_client(file_format, file_type, file_path)
        async with websocket:
            pass
        t1 = time()
        return t1 - t0

    dt = await connect(file_format, file_type, file_path)
    assert dt < 1
    dt = await connect(file_format, file_type, file_path)
    assert dt < 1

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
    )
    await room.initialize()
    return room, loader


def _client_notebook(client_id: int = 1) -> YNotebook:
    """A client YNotebook with a Yjs-like (uint32) client id.

    Real collaborative clients are y-websocket/Yjs, which use uint32 client ids;
    the server relies on that to tell genuine client edits (small ids) from
    deterministic disk rebuilds (large, marked ids). Tests must mirror this, so
    a client's edits are recognised as edits rather than mistaken for a rebuild.
    """
    return YNotebook(Doc(client_id=client_id))


def _sync_documents(client_doc: YNotebook, room: DocumentRoom) -> dict:
    room.ydoc.apply_update(client_doc.ydoc.get_update())
    client_doc.ydoc.apply_update(room.ydoc.get_update())
    return client_doc.get(deduplicate=False)


async def test_notebook_reconnect_with_divergent_history_does_not_duplicate_initial_cell():
    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "divergent-history-before")
    client_doc = _client_notebook()

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


async def test_notebook_reconnect_does_not_revert_cell_to_previous_version():
    """A stale client must catch up to content that changed while it was away.

    Regression test for the sporadic "cell content resets to a previous version"
    report (no YStore, long session, occasional server restart):

      1. The client opens the notebook and caches cell-1 = "old".
      2. The client goes idle / loses its socket but keeps its in-memory YDoc.
      3. Meanwhile the cell is changed to "new" and saved to disk (by another
         client or an out-of-band edit).
      4. The server restarts. With a no-op store the room is rebuilt from disk.
         The rebuild is content-addressed, so "new" is authored under a client id
         derived from the new content (distinct from the id the client holds for
         "old") instead of colliding at the same (client_id, clock).
      5. The client reconnects and syncs its stale cell into the room. Because the
         client made no edits, the deferred repair adopts the authoritative
         on-disk version and drops the stale copy; the client then catches up to
         "new" (no conflict). Previously the state vectors falsely matched and the
         client was left stuck on "old".
    """
    before = _notebook_model()
    before["cells"][0]["source"] = "old version of the cell"
    room_a, loader_a = await _create_notebook_room(before, "revert-before")
    client_doc = _client_notebook()
    try:
        # Initial connection: the client caches the "old" content (no edits).
        client_doc.ydoc.apply_update(room_a.ydoc.get_update())
        assert client_doc.get()["cells"][0]["source"] == "old version of the cell"
    finally:
        await room_a.stop()
        await loader_a.clean()

    # The cell is changed to "new" and saved while the client is away; the server
    # restarts and rebuilds the room from the new on-disk content.
    after = _notebook_model()
    after["cells"][0]["source"] = "new version of the cell"
    room_b, loader_b = await _create_notebook_room(after, "revert-after")
    try:
        # Reconnect: the client syncs its stale cell into the room.
        channel = _HandshakeChannel(client_doc)
        await room_b.serve(channel)

        def _server_source() -> str | None:
            cells = _server_notebook(room_b).get(deduplicate=False)["cells"]
            return cells[0]["source"] if len(cells) == 1 else None

        # The repair recognises the client made no edits and adopts the
        # authoritative on-disk version, dropping the stale copy.
        await _wait_until(lambda: _server_source() == "new version of the cell")
        assert _server_cell_ids(room_b) == ["cell-1"]
        assert _server_source() == "new version of the cell"
        # No conflict was surfaced: the client had no edits to preserve.
        assert all(m[0] != MessageType.RAW for m in channel.received)

        # The client catches up to the new content when it pulls the repair.
        client_doc.ydoc.apply_update(room_b.ydoc.get_update(client_doc.ydoc.get_state()))
        assert client_doc.get()["cells"][0]["source"] == "new version of the cell"
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_notebook_reconnect_conflict_preserves_client_source_edit():
    """A client source edit that conflicts with a changed-on-disk cell is kept.

    The client edits cell-1's source while, concurrently, the same cell is
    changed on disk (another client or an external tool) and the room is rebuilt
    from it after a no-op-store restart. The content-addressed rebuild gives the
    on-disk version a client id distinct from the one the client holds, so on
    reconnect both survive as a divergent same-id cell rather than colliding.
    Because the client edited the cell, the repair keeps the client's copy and
    surfaces a conflict (the on-disk version stays recoverable via Revert), so
    the user's edit is never silently dropped and the room stays coherent.
    """
    before = _notebook_model()
    before["cells"][0]["source"] = "shared"
    room_a, loader_a = await _create_notebook_room(before, "edit-conflict-before")
    client_doc = _client_notebook()
    try:
        client_doc.ydoc.apply_update(room_a.ydoc.get_update())
        # The client appends to the cell source (authored under its own id).
        source = client_doc.ycells[0]["source"]
        source.insert(len(str(source)), " + my local edit")
    finally:
        await room_a.stop()
        await loader_a.clean()

    # The same cell is changed on disk while the client was away.
    after = _notebook_model()
    after["cells"][0]["source"] = "shared + disk edit"
    room_b, loader_b = await _create_notebook_room(after, "edit-conflict-after")
    try:
        # The client reconnects and stays connected to observe the broadcast.
        channel = _HandshakeChannel(client_doc, stay_connected=True)
        async with create_task_group() as tg:
            tg.start_soon(room_b.serve, channel)
            await _wait_until(lambda: any(m[0] == MessageType.RAW for m in channel.received))
            channel.disconnect()

        # A conflict was surfaced rather than a silent merge or revert.
        conflict = [m for m in channel.received if m[0] == MessageType.RAW]
        assert conflict, "expected a RAW conflict broadcast"
        assert b'"type": "conflict"' in conflict[0]

        # The room stays coherent and keeps the client's edit; the on-disk copy
        # is dropped (Revert can restore it).
        cells = _server_notebook(room_b).get(deduplicate=False)["cells"]
        assert len(cells) == 1, cells
        assert cells[0]["source"] == "shared + my local edit", cells[0]["source"]
    finally:
        await room_b.stop()
        await loader_b.clean()


def _server_cell_ids(room: DocumentRoom) -> list[str]:
    """Read the raw (non-deduplicated) cell IDs from a room's YDoc."""
    snapshot = YNotebook()
    snapshot.ydoc.apply_update(room.ydoc.get_update())
    return [c["id"] for c in snapshot.get(deduplicate=False)["cells"]]


async def _wait_until(predicate: Callable[[], bool], timeout: float = 2.0) -> None:
    """Poll an async-friendly predicate until true or the timeout elapses."""
    elapsed = 0.0
    step = 0.02
    while not predicate() and elapsed < timeout:
        await sleep(step)
        elapsed += step


async def test_notebook_reconnect_deduplicates_added_cell_after_restart():
    """A cell added during the session must not survive twice after a restart.

    Regression test for the silent cell-duplication reported after a server
    restart on a long-running session backed by a no-op store (history is not
    persisted, so every room is rebuilt deterministically from disk with
    Doc(client_id=0)).

    Timeline:
      1. The client opens the notebook and receives [cell-1] (client_id=0).
      2. The client appends cell-2. Because the edit originates on the client,
         cell-2 is created under the client's own (random) client id.
      3. Autosave persists [cell-1, cell-2] to disk.
      4. The server restarts. The no-op store keeps nothing, so the room is
         rebuilt from disk and _apply_deterministic_source_content recreates
         BOTH cells under client_id=0; cell-2 now lives at (client_id=0, ...).
      5. The client reconnects. serve() sends SYNC_STEP1 (the server's state
         vector); the client replies with SYNC_STEP2 carrying the items the
         server's vector does not cover, i.e. its own (client_id != 0) cell-2.

    The server's vector already covers client_id=0 but knows nothing of the
    client's id, so handle_sync_message appends the client's cell-2 as a new
    array entry next to the one rebuilt under client_id=0, without raising.
    Because the two copies are identical, DocumentRoom removes the redundant
    one (no user data lost) and the room converges back to [cell-1, cell-2].

    Unlike test_notebook_reconnect_sends_conflict_when_cell_structure_changes_between_restarts
    (which edits cell *source*, shifting a parent clock and raising "block
    parent"), an array-level insert keeps every parent valid, so the symptom is
    duplicated cells rather than an exception.
    """
    notebook = _notebook_model()  # one cell: cell-1
    room_a, loader_a = await _create_notebook_room(notebook, "dup-before")
    client_doc = _client_notebook()
    try:
        # Client connects and receives the original client_id=0 history.
        client_doc.ydoc.apply_update(room_a.ydoc.get_update())
        # Client appends a second cell, created under the client's own id.
        client_doc.append_cell(
            {
                "cell_type": "code",
                "id": "cell-2",
                "metadata": {},
                "source": "y = 2",
                "outputs": [],
                "execution_count": None,
            }
        )
        # Autosave would persist both cells to disk.
        autosaved = client_doc.get(deduplicate=False)
    finally:
        await room_a.stop()
        await loader_a.clean()

    # Server restart: rebuild the room deterministically from the autosaved
    # file. Both cells are now recreated under client_id=0.
    room_b, loader_b = await _create_notebook_room(autosaved, "dup-after")
    try:
        assert _server_cell_ids(room_b) == ["cell-1", "cell-2"]

        # The client reconnects and completes the sync handshake. This momentarily
        # duplicates cell-2, then the deferred repair removes the redundant copy.
        channel = _HandshakeChannel(client_doc)
        await room_b.serve(channel)
        await _wait_until(lambda: _server_cell_ids(room_b) == ["cell-1", "cell-2"])

        # The room converged to a single cell-2, no duplication.
        assert _server_cell_ids(room_b) == ["cell-1", "cell-2"]
        # The duplicate was exact, so no conflict was raised.
        assert all(m[0] != MessageType.RAW for m in channel._sent)
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_notebook_reconnect_preserves_uniquely_added_cell():
    """Cells the client added that are not on disk survive the dedup repair.

    The client adds two cells: cell-2 is autosaved to disk (so the rebuilt room
    holds a client_id=0 copy of it, which the reconnect then duplicates), while
    cell-3 is added afterwards and never persisted, so it exists only under the
    client's id. Deduplicating cell-2 must not disturb the unique cell-3.
    """
    notebook = _notebook_model()  # one cell: cell-1
    room_a, loader_a = await _create_notebook_room(notebook, "unique-before")
    client_doc = _client_notebook()
    try:
        client_doc.ydoc.apply_update(room_a.ydoc.get_update())
        # cell-2 is added and autosaved, so it ends up on disk.
        client_doc.append_cell(
            {
                "cell_type": "code",
                "id": "cell-2",
                "metadata": {},
                "source": "y = 2",
                "outputs": [],
                "execution_count": None,
            }
        )
        autosaved = client_doc.get(deduplicate=False)
        # cell-3 is added afterwards and never saved: it exists only on the client.
        client_doc.append_cell(
            {
                "cell_type": "code",
                "id": "cell-3",
                "metadata": {},
                "source": "z = 3",
                "outputs": [],
                "execution_count": None,
            }
        )
    finally:
        await room_a.stop()
        await loader_a.clean()

    # Server restart: rebuild from the autosaved file (cell-1 and cell-2 only).
    room_b, loader_b = await _create_notebook_room(autosaved, "unique-after")
    try:
        assert _server_cell_ids(room_b) == ["cell-1", "cell-2"]

        # Reconnecting duplicates cell-2 and brings the never-saved cell-3.
        channel = _HandshakeChannel(client_doc)
        await room_b.serve(channel)
        await _wait_until(lambda: _server_cell_ids(room_b) == ["cell-1", "cell-2", "cell-3"])

        # cell-2 was deduplicated while the unique cell-3 was preserved intact.
        cells = _server_notebook(room_b).get(deduplicate=False)["cells"]
        assert [c["id"] for c in cells] == ["cell-1", "cell-2", "cell-3"]
        cell_3 = next(c for c in cells if c["id"] == "cell-3")
        assert cell_3["source"] == "z = 3"
        # The duplicate was exact, so no conflict was raised.
        assert all(m[0] != MessageType.RAW for m in channel._sent)
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_notebook_reconnect_raises_conflict_when_duplicate_cells_diverge():
    """Divergent same-id cells keep the client's copy and surface a conflict.

    Same setup as the deduplication test, but the client runs cell-2 *after*
    the autosave (bumping its execution_count), so its copy diverges from the
    version persisted to disk (and thus from the deterministically rebuilt
    server copy, which carries client_id=0). The client's in-memory edit is the
    data at risk, so DocumentRoom drops the on-disk copy and keeps the client's,
    then broadcasts a RAW conflict so the frontend can offer Save As or Revert
    (the on-disk version is always recoverable through Revert).

    A never-saved cell-3 is added as well to confirm that resolving the
    divergent cell-2 leaves uniquely-added cells untouched.
    """
    notebook = _notebook_model()  # one cell: cell-1
    room_a, loader_a = await _create_notebook_room(notebook, "diverge-before")
    client_doc = _client_notebook()
    try:
        client_doc.ydoc.apply_update(room_a.ydoc.get_update())
        client_doc.append_cell(
            {
                "cell_type": "code",
                "id": "cell-2",
                "metadata": {},
                "source": "y = 2",
                "outputs": [],
                "execution_count": None,
            }
        )
        # Autosave persists cell-2 with execution_count None.
        autosaved = client_doc.get(deduplicate=False)
        # The client runs cell-2 *after* the save, diverging from disk.
        client_doc.ycells[1]["execution_count"] = 5
        # cell-3 is added afterwards and never saved: it exists only on the client.
        client_doc.append_cell(
            {
                "cell_type": "code",
                "id": "cell-3",
                "metadata": {},
                "source": "z = 3",
                "outputs": [],
                "execution_count": None,
            }
        )
    finally:
        await room_a.stop()
        await loader_a.clean()

    # Server restart: rebuild from the autosaved file (cell-2 source "y = 2").
    room_b, loader_b = await _create_notebook_room(autosaved, "diverge-after")
    try:
        # The client reconnects through serve(). It stays connected so it can
        # observe the conflict the server broadcasts from its deferred repair.
        channel = _HandshakeChannel(client_doc, stay_connected=True)
        async with create_task_group() as tg:
            tg.start_soon(room_b.serve, channel)
            await _wait_until(lambda: any(m[0] == MessageType.RAW for m in channel.received))
            channel.disconnect()

        # A conflict was surfaced rather than a silent merge.
        conflict = [m for m in channel.received if m[0] == MessageType.RAW]
        assert conflict, "expected a RAW conflict broadcast"
        assert b'"type": "conflict"' in conflict[0]

        cells = _server_notebook(room_b).get(deduplicate=False)["cells"]
        # The client's copy (execution_count 5) is kept; the on-disk copy
        # (client_id=0, execution_count None) is dropped and recoverable via Revert.
        cell_2_execution_count_list = [c["execution_count"] for c in cells if c["id"] == "cell-2"]
        assert cell_2_execution_count_list == [5], cell_2_execution_count_list
        # The never-saved cell-3 is preserved intact.
        assert [c["id"] for c in cells] == ["cell-1", "cell-2", "cell-3"]
        cell_3 = next(c for c in cells if c["id"] == "cell-3")
        assert cell_3["source"] == "z = 3"
    finally:
        await room_b.stop()
        await loader_b.clean()


def _server_notebook(room: DocumentRoom) -> YNotebook:
    snapshot = YNotebook()
    snapshot.ydoc.apply_update(room.ydoc.get_update())
    return snapshot

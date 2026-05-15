# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from copy import deepcopy
from importlib.metadata import entry_points
from time import time

import pytest
from anyio import create_task_group, sleep
from jupyter_server_ydoc.loaders import FileLoader
from jupyter_server_ydoc.rooms import DocumentRoom
from jupyter_server_ydoc.test_utils import FakeContentsManager, FakeEventLogger, FakeFileIDManager
from jupyter_ydoc import YNotebook
from pycrdt import Provider
from pycrdt.websocket.websocket import HttpxWebsocket

jupyter_ydocs = {ep.name: ep.load() for ep in entry_points(group="jupyter_ydoc")}


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


async def test_notebook_reconnect_fails_when_cell_structure_changes_between_restarts():
    """Reconnecting after cell structure changes causes apply_update to raise RuntimeError.

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
        merged = _sync_documents(client_doc, room_b)
    finally:
        await room_b.stop()
        await loader_b.clean()

    assert len(merged["cells"]) == 1

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import sys
from time import time

if sys.version_info < (3, 10):
    from importlib_metadata import entry_points
else:
    from importlib.metadata import entry_points

from copy import deepcopy

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


async def test_notebook_reconnect_with_divergent_history_duplicates_initial_cell():
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

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import sys
from time import time

if sys.version_info < (3, 10):
    from importlib_metadata import entry_points
else:
    from importlib.metadata import entry_points

import pytest
from anyio import create_task_group, sleep
from pycrdt_websocket import WebsocketProvider

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

    async with await rtc_connect_doc_client(file_format, file_type, file_path) as ws:
        async with WebsocketProvider(jupyter_ydoc.ydoc, ws):
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
        async with await rtc_connect_doc_client(file_format, file_type, file_path) as ws:
            pass

    t0 = time()
    async with create_task_group() as tg:
        tg.start_soon(connect, file_format, file_type, file_path)
        tg.start_soon(connect, file_format, file_type, file_path)
    t1 = time()
    assert t1 - t0 < 0.5

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
        async with await rtc_connect_doc_client(file_format, file_type, file_path) as ws:
            pass
        t1 = time()
        return t1 - t0

    dt = await connect(file_format, file_type, file_path)
    assert dt < 1
    dt = await connect(file_format, file_type, file_path)
    assert dt < 1

    await cleanup(jp_serverapp)

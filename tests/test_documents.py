# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import sys

if sys.version_info < (3, 10):
    from importlib_metadata import entry_points
else:
    from importlib.metadata import entry_points

from anyio import sleep
from pycrdt_websocket import WebsocketProvider

jupyter_ydocs = {ep.name: ep.load() for ep in entry_points(group="jupyter_ydoc")}


async def test_dirty(
    rtc_create_file,
    rtc_connect_doc_client,
):
    file_format = "text"
    file_type = "file"
    file_path = "dummy.txt"
    await rtc_create_file(file_path)
    jupyter_ydoc = jupyter_ydocs[file_type]()

    async with await rtc_connect_doc_client(file_format, file_type, file_path) as ws:
        async with WebsocketProvider(jupyter_ydoc.ydoc, ws):
            jupyter_ydoc.dirty = True
            assert jupyter_ydoc.dirty
            await sleep(1.5)
            assert not jupyter_ydoc.dirty

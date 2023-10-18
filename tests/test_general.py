# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

from asyncio import create_task, sleep, wait

import nbformat
from jupyter_ydoc import YNotebook, YUnicode
from ypy_websocket import WebsocketProvider


async def test_clients(rtc_create_file, rtc_connect_doc_client):
    file_path = "test.txt"
    file_format = "text"
    file_type = "file"
    await rtc_create_file(file_path)

    async def fn(
        format: str, type: str, path: str, doc: YUnicode, content: int | None = None
    ) -> None:
        ydoc = doc.ydoc
        test_array = ydoc.get_array("test")

        async with await rtc_connect_doc_client(format, type, path) as ws, WebsocketProvider(
            ydoc, ws
        ):
            if content is not None:
                with ydoc.begin_transaction() as txn:
                    test_array.extend(txn, [content])
            await sleep(0.2)

    clients = []
    n = 10
    for _ in range(n):
        doc = YUnicode()
        clients.append(create_task(fn(file_format, file_type, file_path, doc, 1)))

    doc = YUnicode()
    test_array = doc.ydoc.get_array("test")
    clients.append(create_task(fn(file_format, file_type, file_path, doc)))

    await wait(clients)

    assert sum(list(test_array)) == n


async def test_clients_insert_text(rtc_create_file, rtc_connect_doc_client):
    file_path = "test.txt"
    file_format = "text"
    file_type = "file"
    await rtc_create_file(file_path)

    async def fn(
        format: str, type: str, path: str, doc: YUnicode, content: str | None = None
    ) -> None:
        async with await rtc_connect_doc_client(format, type, path) as ws, WebsocketProvider(
            doc.ydoc, ws
        ):
            if content is not None:
                with doc.ydoc.begin_transaction() as txn:
                    doc._ysource.extend(txn, content)

            await sleep(0.2)

    n = 10
    content = "test"
    res = len(content) * n

    clients = []
    for _ in range(n):
        doc = YUnicode()
        clients.append(create_task(fn(file_format, file_type, file_path, doc, content)))

    doc = YUnicode()
    clients.append(create_task(fn(file_format, file_type, file_path, doc)))

    await wait(clients)

    assert len(doc._ysource) == res


async def test_clients_insert_cell(rtc_create_notebook, rtc_connect_doc_client):
    file_path = "test.ipynb"
    file_format = "json"
    file_type = "notebook"
    await rtc_create_notebook(file_path)

    async def fn(
        format: str, type: str, path: str, doc: YNotebook, content: str | None = ""
    ) -> None:
        async with await rtc_connect_doc_client(format, type, path) as ws, WebsocketProvider(
            doc.ydoc, ws
        ):
            if content is not None:
                doc.append_cell(nbformat.v4.new_code_cell(content))
            await sleep(0.2)

    n = 10
    clients = []
    for _ in range(n):
        doc = YNotebook()
        clients.append(create_task(fn(file_format, file_type, file_path, doc, "test")))

    doc = YNotebook()
    clients.append(create_task(fn(file_format, file_type, file_path, doc, None)))

    await wait(clients)

    # +1 For the initial cell :(
    assert doc.cell_number == n + 1

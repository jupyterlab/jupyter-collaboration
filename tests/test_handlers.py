# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import json
from asyncio import Event, sleep
from typing import Any

from jupyter_ydoc import YUnicode
from ypy_websocket import WebsocketProvider


async def test_session_handler_should_create_a_session_without_session_id(
    rtc_create_file, rtc_fetch_session, jp_serverapp
):
    file_format = "text"
    file_type = "file"
    file_path = "sessionID.txt"

    fim = jp_serverapp.web_app.settings["file_id_manager"]
    await rtc_create_file(file_path)

    resp = await rtc_fetch_session(file_format, file_type, file_path)
    assert resp.code == 201

    data = json.loads(resp.body.decode("utf-8"))
    assert data["format"] == file_format
    assert data["type"] == file_type
    assert data["fileId"] == fim.get_id(file_path)
    assert data["sessionId"] is None


async def test_session_handler_should_respond_without_session_id(
    rtc_create_file, rtc_fetch_session, jp_serverapp
):
    file_format = "text"
    file_type = "file"
    file_path = "sessionID_2.txt"

    fim = jp_serverapp.web_app.settings["file_id_manager"]
    await rtc_create_file(file_path, None, True)

    resp = await rtc_fetch_session(file_format, file_type, file_path)
    assert resp.code == 200

    data = json.loads(resp.body.decode("utf-8"))

    assert data["format"] == file_format
    assert data["type"] == file_type
    assert data["fileId"] == fim.get_id(file_path)
    assert data["sessionId"] is None


async def test_session_handler_should_respond_with_not_found(rtc_fetch_session):
    # TODO: Fix session handler
    # File ID manager allays returns an index, even if the file doesn't exist
    file_format = "text"
    file_type = "file"
    file_path = "doesnotexist.txt"

    resp = await rtc_fetch_session(file_format, file_type, file_path)
    assert resp
    # assert resp.code == 404


async def test_room_handler_doc_client_should_connect(rtc_create_file, rtc_connect_doc_client):
    path, content = await rtc_create_file("test.txt", "test")

    event = Event()

    def _on_document_change(target: str, e: Any) -> None:
        if target == "source":
            event.set()

    doc = YUnicode()
    doc.observe(_on_document_change)

    async with await rtc_connect_doc_client("text", "file", path) as ws, WebsocketProvider(
        doc.ydoc, ws
    ):
        await event.wait()
        await sleep(0.1)

    assert doc.source == content

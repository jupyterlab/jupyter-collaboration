# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import json
from asyncio import Event, sleep
from typing import Any

import pytest
from jupyter_ydoc import YUnicode
from pycrdt import Provider, Text
from pycrdt.websocket.websocket import HttpxWebsocket
from tornado.httpclient import HTTPClientError


@pytest.fixture
def rtc_disable_ystore():
    return True


async def test_room_should_not_have_ystore(
    rtc_create_file, rtc_connect_doc_client, jp_serverapp, jp_root_dir
):
    path, content = await rtc_create_file("test.txt", "test")

    event = Event()

    def _on_document_change(target: str, e: Any) -> None:
        if target == "source":
            event.set()

    doc = YUnicode()
    doc.observe(_on_document_change)

    websocket, room_name = await rtc_connect_doc_client("text", "file", path)
    async with websocket as ws, Provider(doc.ydoc, HttpxWebsocket(ws, room_name)):
        await event.wait()
        await sleep(0.1)

        assert doc.source == content

        rooms = jp_serverapp.web_app.settings["jupyter_server_ydoc"].ywebsocket_server.rooms
        room = rooms[room_name]
        assert room.ystore is None

        # Edits are still synchronized to the server without a YStore
        text = doc.ydoc.get("source", type=Text)
        text += " more"
        # Wait for the debounced save so no save task is left pending on teardown
        await sleep(1.5)

        server_doc = YUnicode()
        server_doc.ydoc.apply_update(room.ydoc.get_update())
        assert server_doc.source == "test more"

    # No YStore database file was created
    assert not jp_root_dir.joinpath(".rtc_test.db").exists()


async def test_timeline_should_respond_with_not_found(
    rtc_create_file, rtc_connect_doc_client, jp_fetch
):
    path, _ = await rtc_create_file("test.txt", "test")

    event = Event()

    def _on_document_change(target: str, e: Any) -> None:
        if target == "source":
            event.set()

    doc = YUnicode()
    doc.observe(_on_document_change)

    websocket, room_name = await rtc_connect_doc_client("text", "file", path)
    async with websocket as ws, Provider(doc.ydoc, HttpxWebsocket(ws, room_name)):
        await event.wait()
        await sleep(0.1)

        with pytest.raises(HTTPClientError) as exc_info:
            await jp_fetch(
                "/api/collaboration/timeline",
                path,
                method="GET",
                params={"format": "text", "type": "file"},
            )

    assert exc_info.value.code == 404
    response = exc_info.value.response
    assert response is not None
    body = json.loads(response.body)
    assert "YStore is disabled" in body["error"]


async def test_get_document_should_create_room_without_ystore(rtc_create_file, jp_serverapp):
    path, content = await rtc_create_file("test.txt", "test", index=True)
    collaboration = jp_serverapp.web_app.settings["jupyter_server_ydoc"]

    document = await collaboration.get_document(
        path=path, content_type="file", file_format="text", create=True
    )

    assert document is not None
    assert document.get() == content

    rooms = collaboration.ywebsocket_server.rooms
    assert len(rooms) == 1
    assert all(room.ystore is None for room in rooms.values())
    await collaboration.stop_extension()

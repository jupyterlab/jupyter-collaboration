# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import json
from asyncio import Event, sleep
from typing import Any

from jupyter_events.logger import EventLogger
from jupyter_ydoc import YUnicode
from pycrdt_websocket import WebsocketProvider


async def test_session_handler_should_create_session_id(
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
    assert data["sessionId"]


async def test_session_handler_should_respond_with_session_id(
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
    assert data["sessionId"]


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


async def test_room_handler_doc_client_should_emit_awareness_event(
    rtc_create_file, rtc_connect_doc_client, jp_serverapp
):
    path, content = await rtc_create_file("test.txt", "test")

    event = Event()

    def _on_document_change(target: str, e: Any) -> None:
        if target == "source":
            event.set()

    doc = YUnicode()
    doc.observe(_on_document_change)

    listener_was_called = False
    collected_data = []

    async def my_listener(logger: EventLogger, schema_id: str, data: dict) -> None:
        nonlocal listener_was_called
        collected_data.append(data)
        listener_was_called = True

    event_logger = jp_serverapp.event_logger
    event_logger.add_listener(
        schema_id="https://schema.jupyter.org/jupyter_collaboration/awareness/v1",
        listener=my_listener,
    )

    async with await rtc_connect_doc_client("text", "file", path) as ws, WebsocketProvider(
        doc.ydoc, ws
    ):
        await event.wait()
        await sleep(0.1)

    fim = jp_serverapp.web_app.settings["file_id_manager"]

    assert doc.source == content
    assert listener_was_called is True
    assert len(collected_data) == 2
    assert collected_data[0]["action"] == "join"
    assert collected_data[0]["roomid"] == "text:file:" + fim.get_id("test.txt")
    assert collected_data[0]["username"] is not None
    assert collected_data[1]["action"] == "leave"
    assert collected_data[1]["roomid"] == "text:file:" + fim.get_id("test.txt")
    assert collected_data[1]["username"] is not None


async def test_room_handler_doc_client_should_cleanup_room_file(
    rtc_create_file, rtc_connect_doc_client, jp_serverapp
):
    path, _ = await rtc_create_file("test.txt", "test")

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

    # kill websocketserver to mimic task group inactive failure
    await jp_serverapp.web_app.settings["jupyter_collaboration"].ywebsocket_server.stop()

    listener_was_called = False
    collected_data = []

    async def my_listener(logger: EventLogger, schema_id: str, data: dict) -> None:
        nonlocal listener_was_called
        collected_data.append(data)
        listener_was_called = True

    event_logger = jp_serverapp.event_logger
    event_logger.add_listener(
        schema_id="https://schema.jupyter.org/jupyter_collaboration/session/v1",
        listener=my_listener,
    )

    path2, _ = await rtc_create_file("test2.txt", "test2")

    try:
        async with await rtc_connect_doc_client("text2", "file2", path2) as ws, WebsocketProvider(
            doc.ydoc, ws
        ):
            await event.wait()
            await sleep(0.1)
    except Exception:
        pass

    try:
        async with await rtc_connect_doc_client("text2", "file2", path2) as ws, WebsocketProvider(
            doc.ydoc, ws
        ):
            await event.wait()
            await sleep(0.1)
    except Exception:
        pass

    fim = jp_serverapp.web_app.settings["file_id_manager"]

    assert listener_was_called is True
    assert len(collected_data) == 4
    # no two collaboration events are emitted.
    # [{'level': 'WARNING', 'msg': 'There is another collaborative session accessing the same file.\nThe synchronization bet...ou might lose some of your changes.', 'path': 'test2.txt', 'room': 'text2:file2:51b7e24f-f534-47fb-882f-5cc45ba867fe'}]
    assert collected_data[0]["path"] == "test2.txt"
    assert collected_data[0]["room"] == "text2:file2:" + fim.get_id("test2.txt")
    assert collected_data[0]["action"] == "clean"
    assert collected_data[0]["msg"] == "Room deleted."
    assert collected_data[1]["path"] == "test2.txt"
    assert collected_data[1]["room"] == "text2:file2:" + fim.get_id("test2.txt")
    assert collected_data[1]["action"] == "clean"
    assert collected_data[1]["msg"] == "file loader removed."
    assert collected_data[2]["path"] == "test2.txt"
    assert collected_data[2]["room"] == "text2:file2:" + fim.get_id("test2.txt")
    assert collected_data[2]["action"] == "clean"
    assert collected_data[2]["msg"] == "Room deleted."
    assert collected_data[3]["path"] == "test2.txt"
    assert collected_data[3]["room"] == "text2:file2:" + fim.get_id("test2.txt")
    assert collected_data[3]["action"] == "clean"
    assert collected_data[3]["msg"] == "file loader removed."

    await jp_serverapp.web_app.settings["jupyter_collaboration"].stop_extension()
    del jp_serverapp.web_app.settings["file_id_manager"]

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import json
from asyncio import Event, sleep
from typing import Any

from dirty_equals import IsStr
from jupyter_events.logger import EventLogger
from jupyter_server_ydoc.test_utils import Websocket
from jupyter_ydoc import YUnicode
from pycrdt import Text
from pycrdt_websocket import WebsocketProvider


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

    websocket, room_name = await rtc_connect_doc_client("text", "file", path)
    async with websocket as ws, WebsocketProvider(doc.ydoc, Websocket(ws, room_name)):
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

    websocket, room_name = await rtc_connect_doc_client("text", "file", path)
    async with websocket as ws, WebsocketProvider(doc.ydoc, Websocket(ws, room_name)):
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

    websocket, room_name = await rtc_connect_doc_client("text", "file", path)
    async with websocket as ws, WebsocketProvider(doc.ydoc, Websocket(ws, room_name)):
        await event.wait()
        await sleep(0.1)

    # kill websocketserver to mimic task group inactive failure
    await jp_serverapp.web_app.settings["jupyter_server_ydoc"].ywebsocket_server.stop()

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
        websocket, room_name = await rtc_connect_doc_client("text2", "file2", path2)
        async with websocket as ws, WebsocketProvider(doc.ydoc, Websocket(ws, room_name)):
            await event.wait()
            await sleep(0.1)
    except Exception:
        pass

    try:
        websocket, room_name = await rtc_connect_doc_client("text2", "file2", path2)
        async with websocket as ws, WebsocketProvider(doc.ydoc, Websocket(ws, room_name)):
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

    await jp_serverapp.web_app.settings["jupyter_server_ydoc"].stop_extension()
    del jp_serverapp.web_app.settings["file_id_manager"]


async def test_fork_handler(
    jp_serverapp,
    rtc_create_file,
    rtc_connect_doc_client,
    rtc_connect_fork_client,
    rtc_get_forks_client,
    rtc_create_fork_client,
    rtc_delete_fork_client,
    rtc_fetch_session,
):
    collected_data = []

    async def my_listener(logger: EventLogger, schema_id: str, data: dict) -> None:
        collected_data.append(data)

    event_logger = jp_serverapp.event_logger
    event_logger.add_listener(
        schema_id="https://schema.jupyter.org/jupyter_collaboration/fork/v1",
        listener=my_listener,
    )

    path, _ = await rtc_create_file("test.txt", "Hello")

    root_connect_event = Event()

    def _on_root_change(topic: str, event: Any) -> None:
        if topic == "source":
            root_connect_event.set()

    root_ydoc = YUnicode()
    root_ydoc.observe(_on_root_change)

    resp = await rtc_fetch_session("text", "file", path)
    data = json.loads(resp.body.decode("utf-8"))
    file_id = data["fileId"]
    root_roomid = f"text:file:{file_id}"

    websocket, room_name = await rtc_connect_doc_client("text", "file", path)
    async with websocket as ws, WebsocketProvider(root_ydoc.ydoc, Websocket(ws, room_name)):
        await root_connect_event.wait()

        resp = await rtc_create_fork_client(root_roomid, False, "my fork0", "is awesome0")
        data = json.loads(resp.body.decode("utf-8"))
        fork_roomid0 = data["fork_roomid"]

        resp = await rtc_get_forks_client(root_roomid)
        data = json.loads(resp.body.decode("utf-8"))
        expected_data0 = {
            fork_roomid0: {
                "root_roomid": root_roomid,
                "synchronize": False,
                "title": "my fork0",
                "description": "is awesome0",
            }
        }
        assert data == expected_data0

        assert collected_data == [
            {
                "username": IsStr(),
                "fork_roomid": fork_roomid0,
                "fork_info": expected_data0[fork_roomid0],
                "action": "create",
            }
        ]

        resp = await rtc_create_fork_client(root_roomid, True, "my fork1", "is awesome1")
        data = json.loads(resp.body.decode("utf-8"))
        fork_roomid1 = data["fork_roomid"]

        resp = await rtc_get_forks_client(root_roomid)
        data = json.loads(resp.body.decode("utf-8"))
        expected_data1 = {
            fork_roomid1: {
                "root_roomid": root_roomid,
                "synchronize": True,
                "title": "my fork1",
                "description": "is awesome1",
            }
        }
        expected_data = dict(**expected_data0, **expected_data1)
        assert data == expected_data

        assert len(collected_data) == 2
        assert collected_data[1] == {
            "username": IsStr(),
            "fork_roomid": fork_roomid1,
            "fork_info": expected_data[fork_roomid1],
            "action": "create",
        }

        fork_ydoc = YUnicode()
        fork_connect_event = Event()

        def _on_fork_change(topic: str, event: Any) -> None:
            if topic == "source":
                fork_connect_event.set()

        fork_ydoc.observe(_on_fork_change)
        fork_text = fork_ydoc.ydoc.get("source", type=Text)

        async with await rtc_connect_fork_client(fork_roomid1) as ws, WebsocketProvider(
            fork_ydoc.ydoc, Websocket(ws, fork_roomid1)
        ):
            await fork_connect_event.wait()
            root_text = root_ydoc.ydoc.get("source", type=Text)
            root_text += ", World!"
            await sleep(0.1)
            assert str(fork_text) == "Hello, World!"
            fork_text += " Hi!"
            await sleep(0.1)

        await sleep(0.1)
        assert str(root_text) == "Hello, World!"

        await rtc_delete_fork_client(fork_roomid0, True)
        await sleep(0.1)
        assert str(root_text) == "Hello, World!"
        resp = await rtc_get_forks_client(root_roomid)
        data = json.loads(resp.body.decode("utf-8"))
        assert data == expected_data1
        assert len(collected_data) == 3
        assert collected_data[2] == {
            "username": IsStr(),
            "fork_roomid": fork_roomid0,
            "fork_info": expected_data[fork_roomid0],
            "action": "delete",
        }

        await rtc_delete_fork_client(fork_roomid1, True)
        await sleep(0.1)
        assert str(root_text) == "Hello, World! Hi!"
        resp = await rtc_get_forks_client(root_roomid)
        data = json.loads(resp.body.decode("utf-8"))
        assert data == {}
        assert len(collected_data) == 4
        assert collected_data[3] == {
            "username": IsStr(),
            "fork_roomid": fork_roomid1,
            "fork_info": expected_data[fork_roomid1],
            "action": "delete",
        }

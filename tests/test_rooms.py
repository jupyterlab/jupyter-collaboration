# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from datetime import datetime

import pytest
from ypy_websocket.yutils import write_var_uint

from jupyter_collaboration.loaders import FileLoader
from jupyter_collaboration.rooms import DocumentRoom
from jupyter_collaboration.utils import RoomMessages

from .utils import FakeContentsManager, FakeEventLogger, FakeFileIDManager


@pytest.mark.asyncio
async def test_should_initialize_document_room_without_store():
    id = "test-id"
    content = "test"
    paths = {id: "test.txt"}
    cm = FakeContentsManager({"content": content})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
    )

    room = DocumentRoom("test-room", "text", "file", loader, FakeEventLogger(), None, None)

    await room.initialize()
    assert room._document.source == content


@pytest.mark.asyncio
async def test_should_initialize_document_room_from_store():
    """
    We need to create test files with Y updates to simulate
    a store.
    """
    pass


@pytest.mark.asyncio
async def test_defined_save_delay_should_save_content_after_document_change():
    id = "test-id"
    content = "test"
    paths = {id: "test.txt"}
    cm = FakeContentsManager({"content": content})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
    )

    room = DocumentRoom("test-room", "text", "file", loader, FakeEventLogger(), None, None, 0.01)

    await room.initialize()
    room._document.source = "Test 2"

    # Wait for a bit more than the poll_interval
    await asyncio.sleep(0.15)

    assert "save" in cm.actions


@pytest.mark.asyncio
async def test_undefined_save_delay_should_not_save_content_after_document_change():
    id = "test-id"
    content = "test"
    paths = {id: "test.txt"}
    cm = FakeContentsManager({"content": content})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
    )

    room = DocumentRoom("test-room", "text", "file", loader, FakeEventLogger(), None, None, None)

    await room.initialize()
    room._document.source = "Test 2"

    # Wait for a bit more than the poll_interval
    await asyncio.sleep(0.15)

    assert "save" not in cm.actions


@pytest.mark.asyncio
async def test_should_reload_content_from_disk():
    id = "test-id"
    content = "test"
    paths = {id: "test.txt"}
    last_modified = datetime.now()
    cm = FakeContentsManager({"last_modified": last_modified, "content": "whatever"})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
    )

    room = DocumentRoom("test-room", "text", "file", loader, FakeEventLogger(), None, None, None)

    await room.initialize()

    # Make sure the time increases
    cm.model["last_modified"] = datetime.fromtimestamp(last_modified.timestamp() + 1)
    cm.model["content"] = content

    await loader.notify()

    msg_id = next(iter(room._messages)).encode("utf8")
    await room.handle_msg(bytes([RoomMessages.RELOAD]) + write_var_uint(len(msg_id)) + msg_id)

    assert room._document.source == content


@pytest.mark.asyncio
async def test_should_not_reload_content_from_disk():
    id = "test-id"
    content = "test"
    paths = {id: "test.txt"}
    last_modified = datetime.now()
    cm = FakeContentsManager({"last_modified": datetime.now(), "content": content})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
    )

    room = DocumentRoom("test-room", "text", "file", loader, FakeEventLogger(), None, None, None)

    await room.initialize()

    # Make sure the time increases
    cm.model["last_modified"] = datetime.fromtimestamp(last_modified.timestamp() + 1)
    cm.model["content"] = "whatever"

    await loader.notify()

    msg_id = list(room._messages.keys())[0].encode("utf8")
    await room.handle_msg(bytes([RoomMessages.OVERWRITE]) + write_var_uint(len(msg_id)) + msg_id)

    assert room._document.source == content

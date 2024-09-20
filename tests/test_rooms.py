# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio

from jupyter_ydoc import YUnicode


async def test_should_initialize_document_room_without_store(rtc_create_mock_document_room):
    content = "test"
    _, _, room = rtc_create_mock_document_room("test-id", "test_path", "test.txt", content)

    await room.initialize()
    assert room._document.source == content


async def test_should_initialize_document_room_from_store(
    rtc_create_SQLite_store, rtc_create_mock_document_room
):
    # TODO: We don't know for sure if it is taking the content from the store.
    # If the content from the store is different than the content from disk,
    # the room will initialize with the content from disk and overwrite the document

    room_id = "test-id"
    path_id = "test_path"
    content = "test"
    store = await rtc_create_SQLite_store("file", room_id, content)
    _, _, room = rtc_create_mock_document_room(room_id, path_id, "test.txt", content, store=store)

    await room.initialize()
    assert room._document.source == content


async def test_should_overwrite_the_store(rtc_create_SQLite_store, rtc_create_mock_document_room):
    id = "test-id"
    content = "test"
    store = await rtc_create_SQLite_store("file", id, "whatever")
    _, _, room = rtc_create_mock_document_room(id, "test_path", "test.txt", content, store=store)

    await room.initialize()
    assert room._document.source == content

    doc = YUnicode()
    await store.apply_updates(id, doc.ydoc)

    assert doc.source == content


async def test_defined_save_delay_should_save_content_after_document_change(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room(
        "test-id", "test_path", "test.txt", content, save_delay=0.01
    )

    await room.initialize()
    room._document.source = "Test 2"

    # Wait for a bit more than the poll_interval
    await asyncio.sleep(0.15)

    assert "save" in cm.actions


async def test_undefined_save_delay_should_not_save_content_after_document_change(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room(
        "test-id", "test_path", "test.txt", content, save_delay=None
    )

    await room.initialize()
    room._document.source = "Test 2"

    # Wait for a bit more than the poll_interval
    await asyncio.sleep(0.15)

    assert "save" not in cm.actions


# The following test should be restored when package versions are fixed.

# async def test_document_path(rtc_create_mock_document_room):
#     id = "test-id"
#     path = "test.txt"
#     new_path = "test2.txt"

#     _, loader, room = rtc_create_mock_document_room(id, path, "")

#     await room.initialize()
#     assert room._document.path == path

#     # Update the path
#     loader._file_id_manager.move(id, new_path)

#     # Wait for a bit more than the poll_interval
#     await asyncio.sleep(0.15)

#     assert room._document.path == new_path

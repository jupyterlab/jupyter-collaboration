# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio

from jupyter_ydoc import YUnicode


async def test_should_initialize_document_room_without_store(rtc_create_mock_document_room):
    content = "test"
    _, _, room = rtc_create_mock_document_room("test-id", "test.txt", content)

    await room.initialize()
    assert room._document.source == content


async def test_should_initialize_document_room_from_store(
    rtc_create_SQLite_store, rtc_create_mock_document_room
):
    # TODO: We don't know for sure if it is taking the content from the store.
    # If the content from the store is different than the content from disk,
    # the room will initialize with the content from disk and overwrite the document

    id = "test-id"
    content = "test"
    store = await rtc_create_SQLite_store("file", id, content)
    _, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, store=store)

    await room.initialize()
    assert room._document.source == content


async def test_should_overwrite_the_store(rtc_create_SQLite_store, rtc_create_mock_document_room):
    id = "test-id"
    content = "test"
    store = await rtc_create_SQLite_store("file", id, "whatever")
    _, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, store=store)

    await room.initialize()
    assert room._document.source == content

    doc = YUnicode()
    await store.apply_updates(doc.ydoc)

    assert doc.source == content


async def test_defined_save_delay_should_save_content_after_document_change(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=0.01)

    await room.initialize()
    room._document.source = "Test 2"

    # Wait for a bit more than the poll_interval
    await asyncio.sleep(0.15)

    assert "save" in cm.actions


async def test_undefined_save_delay_should_not_save_content_after_document_change(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=None)

    await room.initialize()
    room._document.source = "Test 2"

    # Wait for a bit more than the poll_interval
    await asyncio.sleep(0.15)

    assert "save" not in cm.actions


async def test_should_not_save_content_when_all_clients_have_autosave_disabled(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=0.01)

    # Disable autosave for all existing clients
    for state in room.awareness._states.values():
        if state is not None:
            state["autosave"] = False

    # Inject a dummy client with autosave disabled
    room.awareness._states[9999] = {"autosave": False}

    await room.initialize()
    room._document.source = "Test 2"

    await asyncio.sleep(0.15)

    assert "save" not in cm.actions


async def test_should_save_content_when_at_least_one_client_has_autosave_enabled(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=0.01)

    # Disable autosave for all existing clients
    for state in room.awareness._states.values():
        if state is not None:
            state["autosave"] = False

    # Inject a dummy client with autosave enabled
    room.awareness._states[10000] = {"autosave": True}

    await room.initialize()
    room._document.source = "Test 2"

    await asyncio.sleep(0.15)

    assert "save" in cm.actions


async def test_manual_save_should_not_have_delay(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=0.5)

    await room.initialize()

    # Trigger a manual save
    room._save_to_disc()

    # Manual save should execute immediately, without waiting for the 0.5s delay
    # Check that save happens within a very short time (100ms should be enough)
    await asyncio.sleep(0.1)

    assert cm.actions.count("save") == 1


async def test_manual_save_with_pending_autosave_should_cancel_autosave(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=1.0)

    await room.initialize()

    room._document.source = "Test 2"

    await asyncio.sleep(0.1)

    assert cm.actions.count("save") == 0

    save_task = room._save_to_disc()

    # Manual save should execute immediately
    await asyncio.sleep(0.1)
    assert save_task.done()

    # Check that the manual save was recorded
    assert cm.actions.count("save") == 1

    await asyncio.sleep(1.0)

    # There should be only one save (the manual one), not two
    assert cm.actions.count("save") == 1


async def test_manual_save_should_execute_immediately_even_with_long_delay(
    rtc_create_mock_document_room,
):
    content = "test"
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=5.0)

    await room.initialize()

    save_task = room._save_to_disc()

    await asyncio.sleep(0.5)

    assert "save" in cm.actions
    assert save_task.done()


async def test_autosave_should_still_have_delay(
    rtc_create_mock_document_room,
):
    content = "test"
    save_delay = 0.3
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=save_delay)

    await room.initialize()

    room._document.source = "Test 3"

    await asyncio.sleep(0.1)
    assert "save" not in cm.actions

    # Wait for the delay to complete
    await asyncio.sleep(save_delay)

    assert "save" in cm.actions


async def test_manual_save_should_work_when_save_delay_is_none_and_save_now_is_true(
    rtc_create_mock_document_room,
):
    """Test that manual saves execute even when save_delay is None."""
    content = "test"
    # When save_delay is None, autosave is disabled
    cm, _, room = rtc_create_mock_document_room("test-id", "test.txt", content, save_delay=None)

    await room.initialize()

    # Trigger a manual save with save_now=True
    # Even though save_delay is None, manual saves should still work
    await room._maybe_save_document(None, save_now=True)

    # Manual save should have executed
    assert cm.actions.count("save") == 1


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

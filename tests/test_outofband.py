# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import nbformat
import pytest
from jupyter_server.services.contents.filemanager import FileContentsManager
from jupyter_server_ydoc.loaders import FileLoader
from jupyter_server_ydoc.rooms import DocumentRoom
from jupyter_server_ydoc.test_utils import FakeEventLogger
from jupyter_server_ydoc.utils import MessageType, OutOfBandChanges
from pycrdt import Decoder
from pycrdt.websocket import YRoom


@pytest.fixture
def document(jp_root_dir, arbitrary_fid_manager, request, jp_asyncio_loop):
    async def create():
        notebook = getattr(request, "param", False)
        path = "document.ipynb" if notebook else "document.txt"
        content = (
            nbformat.v4.new_notebook(cells=[nbformat.v4.new_code_cell("original")])
            if notebook
            else "original"
        )
        # Keep disk operations on the event-loop thread: pycrdt subscriptions
        # and events must not be garbage-collected by a file I/O worker thread.
        cm = FileContentsManager(root_dir=str(jp_root_dir))
        model = {
            "type": "notebook" if notebook else "file",
            "format": "json" if notebook else "text",
            "content": content,
        }
        cm.save(model, path)
        file_id = arbitrary_fid_manager.index(path)
        loader = FileLoader(file_id, arbitrary_fid_manager, cm)
        room = DocumentRoom(
            "test-room", model["format"], model["type"], loader, FakeEventLogger(), None, None
        )
        await room.initialize()
        room._document.dirty = False
        return cm, loader, room, model, path

    result = jp_asyncio_loop.run_until_complete(create())
    yield result
    jp_asyncio_loop.run_until_complete(result[2].stop())
    jp_asyncio_loop.run_until_complete(result[1].clean())


@pytest.mark.parametrize("document", [False, True], indirect=True)
@pytest.mark.parametrize("dirty", [False, True])
@pytest.mark.parametrize("trigger", ["poll", "save", "both"])
async def test_external_changes_wait_for_user_without_creating_files(document, dirty, trigger):
    cm, loader, room, model, path = document
    if dirty:
        if model["type"] == "file":
            room._document.source = "unsaved shared edits"
        else:
            content = await room._document.aget()
            content["cells"][0]["source"] = "unsaved shared edits"
            await room._document.aset(content)
    shared = await room._document.aget()
    external = "external version" if model["type"] == "file" else nbformat.v4.new_notebook()
    cm.save({**model, "content": external}, path)
    if trigger == "poll":
        await loader.maybe_notify()
    elif trigger == "save":
        await room._maybe_save_document(None, save_now=True)
    else:
        await asyncio.gather(loader.maybe_notify(), room._maybe_save_document(None, save_now=True))
    assert loader.path == path
    assert await room._document.aget() == shared
    assert cm.get(path)["content"] == external
    assert len(cm.get("")["content"]) == 1
    assert room._document.dirty
    assert room.outofband == {"originalPath": path}
    for _ in range(2):
        await loader.maybe_notify()
        with pytest.raises(OutOfBandChanges):
            await loader.maybe_save_content(model)
    assert len(cm.get("")["content"]) == 1


async def test_identical_external_write_does_not_prompt(document):
    cm, loader, room, model, path = document
    cm.save(model, path)
    await loader.maybe_notify()
    assert loader.path == path
    assert room.outofband is None
    assert not room._document.dirty


@pytest.mark.parametrize("document", [False, True], indirect=True)
@pytest.mark.parametrize("action", ["open", "save-as"])
async def test_reopening_disk_version_leaves_other_clients_in_old_room(
    document, arbitrary_fid_manager, action
):
    cm, loader, room, model, path = document
    original = await room._document.aget()
    external = (
        "external"
        if model["type"] == "file"
        else nbformat.v4.new_notebook(cells=[nbformat.v4.new_code_cell("external")])
    )
    cm.save({**model, "content": external}, path)
    external = cm.get(path)["content"]
    await loader.maybe_notify()
    if action == "save-as":
        await room.save_as("saved-" + path, path)
        assert cm.get("saved-" + path)["content"] == original
    else:
        await room.open_disk_version(path)
    new_id = arbitrary_fid_manager.index(path)
    assert new_id != loader.file_id
    new_loader = FileLoader(new_id, arbitrary_fid_manager, cm)
    new_room = DocumentRoom(
        "new-room", model["format"], model["type"], new_loader, FakeEventLogger(), None, None
    )
    try:
        await new_room.initialize()
        loaded = await new_room._document.aget()
        assert (loaded if model["type"] == "file" else loaded["cells"][0]["source"]) == "external"
        assert await room._document.aget() == original
        assert room.outofband == {"originalPath": path}
        # A second user makes the same choice: do not detach the new disk session.
        await room.open_disk_version(path)
        assert arbitrary_fid_manager.get_id(path) == new_id
        await loader.maybe_notify()
        with pytest.raises(OutOfBandChanges):
            await loader.maybe_save_content(model)
        assert cm.get(path)["content"] == external
    finally:
        await new_room.stop()
        await new_loader.clean()


@pytest.mark.parametrize("document", [False, True], indirect=True)
async def test_save_as_is_personal_and_uses_chosen_name(document):
    cm, loader, room, model, path = document
    original = await room._document.aget()
    external = "external" if model["type"] == "file" else nbformat.v4.new_notebook()
    cm.save({**model, "content": external}, path)
    await loader.maybe_notify()
    chosen = "chosen.ipynb" if model["type"] == "notebook" else "chosen.txt"
    await room.save_as(chosen, path)
    assert loader.path == path
    assert room._document.path == path
    assert await room._document.aget() == original
    assert room.outofband == {"originalPath": path}
    assert cm.get(chosen)["content"] == original
    assert cm.get(path)["content"] == external
    # Other users can still open the original or save their own version.
    await room.open_disk_version(path)
    await room.save_as("another-" + chosen, path)
    assert cm.get("another-" + chosen)["content"] == original


async def test_save_as_failure_keeps_both_versions_and_allows_retry(
    document, arbitrary_fid_manager
):
    cm, loader, room, model, path = document
    cm.save({**model, "content": "external"}, path)
    await loader.maybe_notify()
    with patch.object(cm, "save", new_callable=AsyncMock, side_effect=OSError("disk full")):
        with pytest.raises(OSError):
            await room.save_as("chosen.txt", path)
    assert room._document.source == "original"
    assert arbitrary_fid_manager.get_id(path) == loader.file_id
    with pytest.raises(OutOfBandChanges):
        await loader.maybe_save_content(model)
    await room.save_as("chosen.txt", path)
    assert cm.get("chosen.txt")["content"] == "original"
    assert cm.get(path)["content"] == "external"


async def test_save_as_rejects_original_and_existing_names(document):
    cm, loader, room, model, path = document
    cm.save({**model, "content": "external"}, path)
    cm.save({**model, "content": "other"}, "existing.txt")
    await loader.maybe_notify()
    for chosen in [path, "existing.txt", ""]:
        with pytest.raises(Exception, match="Choose a new filename"):
            await room.save_as(chosen, path)
    assert cm.get(path)["content"] == "external"
    assert cm.get("existing.txt")["content"] == "other"


def decode_status(message):
    decoder = Decoder(message)
    assert decoder.read_var_uint() == MessageType.RAW
    return json.loads(decoder.read_var_string())


async def test_external_change_status_broadcast_and_clear(document):
    cm, loader, room, model, path = document
    clients = [MagicMock(send=AsyncMock()), MagicMock(send=AsyncMock())]
    room.clients.update(clients)
    cm.save({**model, "content": "external"}, path)
    await loader.maybe_notify()
    for client in clients:
        assert decode_status(client.send.call_args.args[0]) == {
            "type": "external-change",
            "change": {"originalPath": path},
        }
        client.send.assert_awaited_once()
    assert "outofband" not in room._document.ystate
    await loader.maybe_notify()
    for client in clients:
        client.send.assert_awaited_once()
    cm.save(model, path)
    await loader.maybe_notify()
    assert room.outofband is None
    for client in clients:
        assert decode_status(client.send.call_args.args[0]) == {
            "type": "external-change",
            "change": None,
        }
        assert client.send.await_count == 2
    room.clients.clear()


async def test_external_change_status_replayed_on_each_connection(document):
    cm, loader, room, model, path = document
    cm.save({**model, "content": "external"}, path)
    await loader.maybe_notify()
    # Also replay after another frontend opens the disk version.
    await room.open_disk_version(path)
    for _ in range(2):
        channel = MagicMock(send=AsyncMock())

        async def serve(client):
            assert client in room.clients
            client.send.assert_awaited_once()

        with patch.object(YRoom, "serve", side_effect=serve):
            await room.serve(channel)
        assert channel not in room.clients
        assert decode_status(channel.send.call_args.args[0]) == {
            "type": "external-change",
            "change": {"originalPath": path},
        }
    assert "outofband" not in room._document.ystate

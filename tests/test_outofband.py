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
def behavior_on_external_change():
    return "ask"


@pytest.fixture
def document(
    jp_root_dir,
    arbitrary_fid_manager,
    request,
    jp_asyncio_loop,
    behavior_on_external_change,
):
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
            "test-room",
            model["format"],
            model["type"],
            loader,
            FakeEventLogger(),
            None,
            None,
            behavior_on_external_change=behavior_on_external_change,
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
async def test_external_changes_wait_for_user_without_creating_files(
    document, dirty, trigger, arbitrary_fid_manager
):
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
    assert arbitrary_fid_manager.index(path) != loader.file_id
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
async def test_reopening_disk_version_leaves_other_clients_in_old_room(
    document, arbitrary_fid_manager
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
        # Notifications from the preserved room must not detach the new disk session.
        await loader.maybe_notify()
        await room._on_outofband_change()
        assert arbitrary_fid_manager.get_id(path) == new_id
        with pytest.raises(OutOfBandChanges):
            await loader.maybe_save_content(model)
        assert cm.get(path)["content"] == external
    finally:
        await new_room.stop()
        await new_loader.clean()


def decode_status(message):
    decoder = Decoder(message)
    assert decoder.read_var_uint() == MessageType.RAW
    return json.loads(decoder.read_var_string())


async def test_external_change_status_broadcast_and_preserved(document):
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
    assert room.outofband == {"originalPath": path}
    for client in clients:
        client.send.assert_awaited_once()
    room.clients.clear()


@pytest.mark.parametrize("deleted", [False, True])
async def test_external_change_status_replayed_on_each_connection(document, jp_root_dir, deleted):
    cm, loader, room, model, path = document
    notice = {"originalPath": path}
    if deleted:
        (jp_root_dir / path).unlink()
        notice["reason"] = "deleted"
    else:
        cm.save({**model, "content": "external"}, path)
    await loader.maybe_notify()
    # The detached session must still replay status on reconnection.
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
            "change": notice,
        }
    assert "outofband" not in room._document.ystate


@pytest.mark.parametrize("document", [False, True], indirect=True)
@pytest.mark.parametrize("trigger", ["poll", "save"])
@pytest.mark.parametrize("remove_mapping", [False, True])
async def test_external_deletion_preserves_content_and_notifies(
    document, jp_root_dir, arbitrary_fid_manager, trigger, remove_mapping
):
    cm, loader, room, model, path = document
    shared = await room._document.aget()
    client = MagicMock(send=AsyncMock())
    room.clients.add(client)
    (jp_root_dir / path).unlink()
    if remove_mapping:
        arbitrary_fid_manager.delete(path)
    try:
        if trigger == "poll":
            await loader.maybe_notify()
        else:
            await room._maybe_save_document(None, save_now=True)
        notice = {"originalPath": path, "reason": "deleted"}
        assert room.outofband == notice
        assert decode_status(client.send.call_args.args[0])["change"] == notice
        assert await room._document.aget() == shared
        assert room._document.dirty
        assert not cm.exists(path)
        await loader.maybe_notify()
        client.send.assert_awaited_once()
        with pytest.raises(OutOfBandChanges):
            await loader.maybe_save_content(model)
    finally:
        room.clients.clear()


async def test_deleted_file_restored_preserves_old_session(document, jp_root_dir):
    cm, loader, room, model, path = document
    (jp_root_dir / path).unlink()
    await loader.maybe_notify()
    assert room.outofband["reason"] == "deleted"
    cm.save(model, path)
    await loader.maybe_notify()
    assert room.outofband == {"originalPath": path, "reason": "deleted"}
    assert loader.deleted


@pytest.mark.parametrize("document", [False, True], indirect=True)
async def test_explicit_overwrite_saves_snapshot_and_preserves_session(document):
    cm, loader, room, model, path = document
    shared = await room._document.aget()
    external = "disk content" if model["type"] == "file" else nbformat.v4.new_notebook()
    cm.save({**model, "content": external}, path)
    await loader.maybe_notify()
    assert room.outofband is not None
    await room.overwrite(path)
    assert cm.get(path)["content"] == shared
    assert await room._document.aget() == shared
    assert room.outofband is not None
    with pytest.raises(OutOfBandChanges):
        await loader.maybe_save_content(model)


async def test_overwrite_rejects_without_external_change(document):
    cm, loader, room, model, path = document
    with pytest.raises(ValueError, match="already been resolved"):
        await room.overwrite(path)


@pytest.mark.parametrize("behavior_on_external_change", ["overwrite"])
@pytest.mark.parametrize("document", [False, True], indirect=True)
@pytest.mark.parametrize("dirty", [False, True])
@pytest.mark.parametrize("trigger", ["poll", "save"])
async def test_reload_mode_updates_document_without_changing_id(
    document, arbitrary_fid_manager, behavior_on_external_change, dirty, trigger
):
    cm, loader, room, model, path = document
    if dirty:
        if model["type"] == "file":
            room._document.source = "unsaved edits"
        else:
            edits = await room._document.aget()
            edits["cells"][0]["source"] = "unsaved edits"
            await room._document.aset(edits)
    external = (
        "external version"
        if model["type"] == "file"
        else nbformat.v4.new_notebook(
            cells=[nbformat.v4.new_code_cell("external")],
            metadata={
                "kernelspec": {"display_name": "Python 3", "name": "python3"},
                "language_info": {"name": "python"},
            },
        )
    )
    cm.save({**model, "content": external}, path)
    client = MagicMock(send=AsyncMock())
    room.clients.add(client)
    try:
        if trigger == "poll":
            await loader.maybe_notify()
        else:
            await room._maybe_save_document(None, save_now=True)
        assert await room._document.aget() == cm.get(path)["content"]
        assert room.outofband is None
        assert not room._document.dirty
        assert arbitrary_fid_manager.index(path) == loader.file_id
        assert room._document.hash == cm.get(path, content=False, require_hash=True)["hash"]
        client.send.assert_not_awaited()
        # Further edits can be saved using the same file loader and ID.
        saved = await loader.maybe_save_content({**model, "content": external})
        assert saved is not None
        assert arbitrary_fid_manager.index(path) == loader.file_id
    finally:
        room.clients.clear()


@pytest.mark.parametrize("behavior_on_external_change", ["overwrite"])
async def test_reload_mode_preserves_deleted_file_and_recovers(
    document, arbitrary_fid_manager, jp_root_dir, behavior_on_external_change
):
    cm, loader, room, model, path = document
    original = await room._document.aget()
    (jp_root_dir / path).unlink()
    await loader.maybe_notify()
    assert room.outofband == {"originalPath": path, "reason": "deleted"}
    assert await room._document.aget() == original
    assert arbitrary_fid_manager.index(path) == loader.file_id
    with pytest.raises(OutOfBandChanges):
        await loader.maybe_save_content(model)
    cm.save({**model, "content": "restored"}, path)
    await loader.maybe_notify()
    assert await room._document.aget() == "restored"
    assert room.outofband is None
    assert not room._document.dirty
    assert arbitrary_fid_manager.index(path) == loader.file_id


@pytest.mark.parametrize("behavior_on_external_change", ["overwrite"])
@pytest.mark.parametrize("failure", ["read", "apply"])
async def test_reload_mode_preserves_content_on_read_failure(
    document, arbitrary_fid_manager, behavior_on_external_change, failure
):
    cm, loader, room, model, path = document
    original = await room._document.aget()
    cm.save({**model, "content": "external"}, path)
    target, method = (loader, "load_content") if failure == "read" else (room._document, "aset")
    with patch.object(target, method, side_effect=OSError("Cannot load file")):
        await loader.maybe_notify()
    assert await room._document.aget() == original
    assert room.outofband == {"originalPath": path}
    assert arbitrary_fid_manager.index(path) == loader.file_id
    with pytest.raises(OutOfBandChanges):
        await loader.maybe_save_content(model)

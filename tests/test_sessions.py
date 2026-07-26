# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import uuid
from copy import deepcopy

from jupyter_server_ydoc.loaders import FileLoader
from jupyter_server_ydoc.rooms import DocumentRoom
from jupyter_server_ydoc.sessions import DocumentSessionStore
from jupyter_server_ydoc.stores import SQLiteYStore
from jupyter_server_ydoc.test_utils import (
    FakeContentsManager,
    FakeEventLogger,
    FakeFileIDManager,
)
from jupyter_ydoc import YNotebook
from traitlets.config import Config

from .test_documents import _create_notebook_room, _notebook_model


def _is_uuid(value: str) -> bool:
    return bool(uuid.UUID(value))


async def _create_notebook_room_with_ystore(
    notebook: dict,
    room_id: str,
    session_store: DocumentSessionStore,
    ystore: SQLiteYStore,
) -> tuple[DocumentRoom, FileLoader]:
    """Like ``_create_notebook_room`` but backed by a real YStore."""
    file_id = f"file-{room_id}"
    loader = FileLoader(
        file_id,
        FakeFileIDManager({file_id: "test.ipynb"}),
        FakeContentsManager({"content": deepcopy(notebook), "writable": True}),
    )
    room = DocumentRoom(
        room_id,
        "json",
        "notebook",
        loader,
        FakeEventLogger(),
        ystore,
        None,
        None,
        document_load_progressively=False,
        session_store=session_store,
    )
    await room.initialize()
    return room, loader


# ---------------------------------------------------------------------------
# DocumentSessionStore unit tests
# ---------------------------------------------------------------------------


def test_get_or_create_is_stable():
    store = DocumentSessionStore()
    session_id = store.get_or_create("room", "rest")
    assert _is_uuid(session_id)
    # Repeated calls return the same ID and do not overwrite the origin.
    assert store.get_or_create("room", "store") == session_id
    session = store.get("room")
    assert session is not None
    assert session.origin == "rest"
    # A different room gets a different ID.
    assert store.get_or_create("other-room", "rest") != session_id


def test_roll_changes_id():
    store = DocumentSessionStore()
    first = store.get_or_create("room", "rest")
    rolled = store.roll("room", "rebuild")
    assert rolled != first
    assert _is_uuid(rolled)
    session = store.get("room")
    assert session is not None
    assert session.session_id == rolled
    assert session.origin == "rebuild"


def test_update_keeps_id_and_mutates_metadata():
    store = DocumentSessionStore()
    first = store.get_or_create("room", "rest")
    updated = store.update("room", "rebuild")
    assert updated == first
    session = store.get("room")
    assert session is not None
    assert session.origin == "rebuild"
    # Updating an unknown room falls back to minting a new session.
    minted = store.update("unknown-room", "store")
    assert _is_uuid(minted)
    minted_session = store.get("unknown-room")
    assert minted_session is not None
    assert minted_session.origin == "store"


def test_persistence_across_instances(tmp_path):
    path = tmp_path / "doc_sessions.json"
    first_store = DocumentSessionStore(path=path)
    session_id = first_store.get_or_create("room", "rest")
    first_store.update("room", "rebuild")
    assert path.exists()

    second_store = DocumentSessionStore(path=path)
    assert second_store.get_or_create("room", "store") == session_id
    session = second_store.get("room")
    assert session is not None
    assert session.origin == "rebuild"


def test_corrupt_file_is_tolerated(tmp_path):
    path = tmp_path / "doc_sessions.json"
    path.write_text("{not json at all")
    store = DocumentSessionStore(path=path)
    assert store.get("room") is None
    # The store keeps working (and can persist over the corrupt file).
    session_id = store.get_or_create("room", "rest")
    assert DocumentSessionStore(path=path).get_or_create("room", "rest") == session_id


def test_non_dict_json_file_is_tolerated(tmp_path):
    path = tmp_path / "doc_sessions.json"
    path.write_text('["valid json", "but not a mapping"]')
    store = DocumentSessionStore(path=path)
    assert store.get("room") is None


def test_memory_only_store_works_without_path():
    store = DocumentSessionStore(path=None)
    session_id = store.get_or_create("room", "rest")
    assert store.get_or_create("room", "rest") == session_id
    assert store.roll("room", "rebuild") != session_id


# ---------------------------------------------------------------------------
# Room-level session lifecycle
# ---------------------------------------------------------------------------


async def test_every_rebuild_rolls_the_session():
    """A rebuild builds brand new Yjs items, so it is a new lineage.

    This holds even when the file did not change: the items are new
    regardless, and pretending otherwise is what would make a reconnecting
    client's tombstones delete content that is live in the room.
    """
    session_store = DocumentSessionStore()
    notebook = _notebook_model()

    room_a, loader_a = await _create_notebook_room(notebook, "room", session_store=session_store)
    session_a = room_a.session_id
    try:
        assert session_a is not None
        session = session_store.get("room")
        assert session is not None
        assert session.origin == "rebuild"
    finally:
        await room_a.stop()
        await loader_a.clean()

    # Byte-identical content, rebuilt again.
    room_b, loader_b = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert room_b.session_id != session_a
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_rebuilds_occupy_disjoint_yjs_coordinates():
    """The invariant the session gate relies on.

    Two rebuilds must never place different items on the same
    ``(client_id, clock)`` coordinates, or a client reconciling by
    tombstoning would delete the room's live content. Rebuilding with a
    fresh random client id every time gives this for free. The cost is that
    merging two lineages duplicates content, which is precisely what the
    session gate exists to prevent.
    """
    notebook = _notebook_model()
    room_a, loader_a = await _create_notebook_room(notebook, "room-a")
    room_b, loader_b = await _create_notebook_room(notebook, "room-b")
    try:
        assert room_a.ydoc.client_id != room_b.ydoc.client_id
        # Merging the two lineages duplicates rather than aliasing: no item
        # of one silently overwrites an item of the other.
        merged = YNotebook()
        merged.ydoc.apply_update(room_a.ydoc.get_update())
        merged.ydoc.apply_update(room_b.ydoc.get_update())
        assert len(merged.get(deduplicate=False)["cells"]) == 2
    finally:
        await room_a.stop()
        await loader_a.clean()
        await room_b.stop()
        await loader_b.clean()


async def test_rest_origin_session_is_adopted_by_first_rebuild():
    """A session minted over REST covers no history yet.

    Rolling it would cost the very first client a refusal round trip for
    nothing, since it has no local content to protect.
    """
    session_store = DocumentSessionStore()
    rest_session = session_store.get_or_create("room", "rest")

    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert room.session_id == rest_session
        session = session_store.get("room")
        assert session is not None
        assert session.origin == "rebuild"
    finally:
        await room.stop()
        await loader.clean()


async def test_store_origin_session_rolls_on_rebuild():
    """A session which covered restored history must not survive a rebuild."""
    session_store = DocumentSessionStore()
    store_session = session_store.roll("room", "store")

    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert room.session_id != store_session
        session = session_store.get("room")
        assert session is not None
        assert session.origin == "rebuild"
    finally:
        await room.stop()
        await loader.clean()


async def test_restore_from_ystore_keeps_session(tmp_path):
    """The one case where the lineage genuinely continues."""
    session_store = DocumentSessionStore()
    notebook = _notebook_model()
    config = Config()
    config.SQLiteYStore.db_path = str(tmp_path / "ystore.db")
    room_id = "room"
    ystore_path = f"notebook:{room_id}.y"

    ystore_a = SQLiteYStore(
        path=ystore_path,
        # `SQLiteYStore` here is a subclass of both `LoggingConfigurable`
        # and `pycrdt.store.SQLiteYStore`, but mypy gets lost:
        config=config,  # type:ignore[call-arg]
    )
    room_a, loader_a = await _create_notebook_room_with_ystore(
        notebook, room_id, session_store, ystore_a
    )
    session_a = room_a.session_id
    try:
        session = session_store.get(room_id)
        assert session is not None
        assert session.origin == "rebuild"
    finally:
        await room_a.stop()
        await loader_a.clean()
        await ystore_a.stop()

    ystore_b = SQLiteYStore(
        path=ystore_path,
        config=config,  # type:ignore[call-arg]
    )
    room_b, loader_b = await _create_notebook_room_with_ystore(
        notebook, room_id, session_store, ystore_b
    )
    try:
        # Restored from the store: the very items the clients hold, so the
        # session is kept and nobody has to reconcile.
        assert room_b.session_id == session_a
        session = session_store.get(room_id)
        assert session is not None
        assert session.origin == "store"
    finally:
        await room_b.stop()
        await loader_b.clean()
        await ystore_b.stop()


async def test_restored_history_recovers_its_session_without_the_store(tmp_path):
    """Losing the session store must not turn a restored history into a new
    lineage: clients holding it would tombstone content that is still live."""
    notebook = _notebook_model()
    config = Config()
    config.SQLiteYStore.db_path = str(tmp_path / "ystore.db")
    room_id = "room"
    ystore_path = f"notebook:{room_id}.y"

    ystore_a = SQLiteYStore(path=ystore_path, config=config)  # type:ignore[call-arg]
    room_a, loader_a = await _create_notebook_room_with_ystore(
        notebook, room_id, DocumentSessionStore(), ystore_a
    )
    session_a = room_a.session_id
    try:
        # The identity of the lineage travels with the lineage itself.
        assert room_a._document.ystate["document_session"] == session_a
    finally:
        await room_a.stop()
        await loader_a.clean()
        await ystore_a.stop()

    # The session store file is gone, the YStore is not.
    empty_store = DocumentSessionStore()
    ystore_b = SQLiteYStore(path=ystore_path, config=config)  # type:ignore[call-arg]
    room_b, loader_b = await _create_notebook_room_with_ystore(
        notebook, room_id, empty_store, ystore_b
    )
    try:
        assert room_b.session_id == session_a
        recovered = empty_store.get(room_id)
        assert recovered is not None
        assert recovered.session_id == session_a
    finally:
        await room_b.stop()
        await loader_b.clean()
        await ystore_b.stop()


async def test_room_publishes_the_hash_of_the_loaded_content():
    """Without this the client cannot tell its unsaved edits from an
    out-of-band change, and has to prompt for a conflict that is not one."""
    room, loader = await _create_notebook_room(_notebook_model(), "room")
    try:
        assert room._document.hash == "fake_hash"
    finally:
        await room.stop()
        await loader.clean()


async def test_adopting_an_out_of_band_change_publishes_the_new_hash():
    room, loader = await _create_notebook_room(_notebook_model(), "room")
    try:
        changed = deepcopy(_notebook_model())
        changed["cells"][0]["source"] = "changed out of band"
        await room._adopt_file_content({"content": changed, "hash": "hash-after"})
        assert room._document.hash == "hash-after"
        assert room._document.dirty is False
    finally:
        await room.stop()
        await loader.clean()


# ---------------------------------------------------------------------------
# Store persistence
# ---------------------------------------------------------------------------


def test_persist_is_atomic_and_leaves_no_temporary_files(tmp_path):
    path = tmp_path / "doc_sessions.json"
    store = DocumentSessionStore(path=path)
    store.get_or_create("room", "rest")
    store.roll("room", "rebuild")
    assert [p.name for p in tmp_path.glob("*.tmp")] == []


def test_persist_failure_keeps_the_previous_store(tmp_path, monkeypatch):
    path = tmp_path / "doc_sessions.json"
    store = DocumentSessionStore(path=path)
    session_id = store.get_or_create("room", "rest")

    def _boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr("jupyter_server_ydoc.sessions.os.replace", _boom)
    store.roll("room", "rebuild")

    # The store on disk is still the last complete one, not a truncated file.
    reloaded = DocumentSessionStore(path=path).get("room")
    assert reloaded is not None
    assert reloaded.session_id == session_id
    assert [p.name for p in tmp_path.glob("*.tmp")] == []

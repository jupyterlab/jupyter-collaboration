# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import uuid
from copy import deepcopy

from jupyter_server_ydoc.loaders import FileLoader
from jupyter_server_ydoc.rooms import DocumentRoom
from jupyter_server_ydoc.sessions import DocumentSessionStore, content_hash
from jupyter_server_ydoc.stores import SQLiteYStore
from jupyter_server_ydoc.test_utils import (
    FakeContentsManager,
    FakeEventLogger,
    FakeFileIDManager,
)
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
    rolled = store.roll("room", "rebuild", rebuild_hash="abc")
    assert rolled != first
    assert _is_uuid(rolled)
    session = store.get("room")
    assert session is not None
    assert session.session_id == rolled
    assert session.origin == "rebuild"
    assert session.rebuild_hash == "abc"


def test_update_keeps_id_and_mutates_metadata():
    store = DocumentSessionStore()
    first = store.get_or_create("room", "rest")
    updated = store.update("room", "rebuild", rebuild_hash="abc")
    assert updated == first
    session = store.get("room")
    assert session is not None
    assert session.origin == "rebuild"
    assert session.rebuild_hash == "abc"
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
    first_store.update("room", "rebuild", rebuild_hash="abc")
    assert path.exists()

    second_store = DocumentSessionStore(path=path)
    assert second_store.get_or_create("room", "store") == session_id
    session = second_store.get("room")
    assert session is not None
    assert session.origin == "rebuild"
    assert session.rebuild_hash == "abc"


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
# content_hash
# ---------------------------------------------------------------------------


def test_content_hash_is_deterministic():
    notebook = _notebook_model()
    assert content_hash(notebook) == content_hash(deepcopy(notebook))


def test_content_hash_ignores_key_order():
    assert content_hash({"a": 1, "b": 2}) == content_hash({"b": 2, "a": 1})


def test_content_hash_differs_for_different_content():
    notebook = _notebook_model()
    changed = deepcopy(notebook)
    changed["cells"][0]["source"] = "changed"
    assert content_hash(notebook) != content_hash(changed)


# ---------------------------------------------------------------------------
# Room-level session lifecycle
# ---------------------------------------------------------------------------


async def test_identical_rebuild_keeps_session():
    session_store = DocumentSessionStore()
    notebook = _notebook_model()

    room_a, loader_a = await _create_notebook_room(notebook, "room", session_store=session_store)
    session_a = room_a.session_id
    try:
        assert session_a is not None
        session = session_store.get("room")
        assert session is not None
        assert session.origin == "rebuild"
        assert session.rebuild_hash == content_hash(notebook)
    finally:
        await room_a.stop()
        await loader_a.clean()

    room_b, loader_b = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert room_b.session_id == session_a
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_changed_rebuild_rolls_session():
    session_store = DocumentSessionStore()
    notebook = _notebook_model()

    room_a, loader_a = await _create_notebook_room(notebook, "room", session_store=session_store)
    session_a = room_a.session_id
    await room_a.stop()
    await loader_a.clean()

    changed = deepcopy(notebook)
    changed["cells"][0]["source"] = "changed"
    room_b, loader_b = await _create_notebook_room(changed, "room", session_store=session_store)
    try:
        assert room_b.session_id != session_a
        session = session_store.get("room")
        assert session is not None
        assert session.rebuild_hash == content_hash(changed)
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_rest_origin_session_is_adopted_by_first_rebuild():
    session_store = DocumentSessionStore()
    # The REST handler mints the session before the room ever exists.
    rest_session = session_store.get_or_create("room", "rest")

    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        # The room keeps the exact session minted over REST and upgrades it
        # to a rebuild lineage.
        assert room.session_id == rest_session
        session = session_store.get("room")
        assert session is not None
        assert session.origin == "rebuild"
        assert session.rebuild_hash == content_hash(notebook)
    finally:
        await room.stop()
        await loader.clean()


async def test_store_origin_session_without_matching_hash_rolls_on_rebuild():
    session_store = DocumentSessionStore()
    # A session which covers YStore-restored history but no known rebuild.
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


async def test_notebook_with_idless_cell_rolls_session_on_every_rebuild():
    session_store = DocumentSessionStore()
    notebook = _notebook_model()
    del notebook["cells"][0]["id"]

    room_a, loader_a = await _create_notebook_room(notebook, "room", session_store=session_store)
    session_a = room_a.session_id
    try:
        # Non-deterministic rebuilds never record a rebuild hash.
        session = session_store.get("room")
        assert session is not None
        assert session.rebuild_hash is None
    finally:
        await room_a.stop()
        await loader_a.clean()

    # Identical content, but the missing cell id makes the rebuild
    # non-deterministic: the session must roll anyway.
    room_b, loader_b = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert room_b.session_id != session_a
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_restore_from_ystore_keeps_session(tmp_path):
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
        # First incarnation rebuilt from disk and wrote its state to the store.
        session = session_store.get(room_id)
        assert session is not None
        assert session.origin == "rebuild"
    finally:
        await room_a.stop()
        await loader_a.clean()
        await ystore_a.stop()

    ystore_b = SQLiteYStore(
        path=ystore_path,
        # `SQLiteYStore` here is a subclass of both `LoggingConfigurable`
        # and `pycrdt.store.SQLiteYStore`, but mypy gets lost:
        config=config,  # type:ignore[call-arg]
    )
    room_b, loader_b = await _create_notebook_room_with_ystore(
        notebook, room_id, session_store, ystore_b
    )
    try:
        # Second incarnation restores the Yjs history from the store: the
        # lineage continues, so the session is kept.
        assert room_b.session_id == session_a
        session = session_store.get(room_id)
        assert session is not None
        assert session.origin == "store"
        # The hash of the rebuild which founded the lineage is preserved.
        assert session.rebuild_hash == content_hash(notebook)
    finally:
        await room_b.stop()
        await loader_b.clean()
        await ystore_b.stop()

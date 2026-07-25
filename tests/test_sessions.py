# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import uuid
from copy import deepcopy

from jupyter_server_ydoc.loaders import FileLoader
from jupyter_server_ydoc.rooms import DocumentRoom
from jupyter_server_ydoc.sessions import DocumentSessionStore, lineage_fingerprint
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
# lineage_fingerprint
# ---------------------------------------------------------------------------


def test_fingerprint_is_deterministic():
    notebook = _notebook_model()
    assert lineage_fingerprint(notebook, "p") == lineage_fingerprint(deepcopy(notebook), "p")


def test_fingerprint_depends_on_key_order():
    """Reordered keys rebuild to different Yjs items, so they must not share
    a fingerprint (``jupyter_ydoc`` inserts map entries in iteration order)."""
    assert lineage_fingerprint({"a": 1, "b": 2}, "p") != lineage_fingerprint({"b": 2, "a": 1}, "p")


def test_fingerprint_depends_on_procedure():
    notebook = _notebook_model()
    assert lineage_fingerprint(notebook, "whole") != lineage_fingerprint(notebook, "progressive")


def test_fingerprint_differs_for_different_content():
    notebook = _notebook_model()
    changed = deepcopy(notebook)
    changed["cells"][0]["source"] = "changed"
    assert lineage_fingerprint(notebook, "p") != lineage_fingerprint(changed, "p")


def test_fingerprint_separates_content_from_procedure():
    """The two parts must not be able to bleed into one another."""
    assert lineage_fingerprint("b", "a") != lineage_fingerprint("", "a\x00b")


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
        assert session.rebuild_hash == room_a._rebuild_fingerprint(notebook)
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
        assert session.rebuild_hash == room_b._rebuild_fingerprint(changed)
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
        assert session.rebuild_hash == room._rebuild_fingerprint(notebook)
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
        assert session.rebuild_hash == room_b._rebuild_fingerprint(notebook)
    finally:
        await room_b.stop()
        await loader_b.clean()
        await ystore_b.stop()


# ---------------------------------------------------------------------------
# A kept session must imply identical Yjs coordinates
# ---------------------------------------------------------------------------


async def test_load_mode_change_rolls_session():
    """Identical content loaded differently is a different lineage.

    Progressive and whole-document loading build different Yjs items, so a
    client holding one must not resynchronize onto the other - merging them
    silently empties cells rather than raising.
    """
    session_store = DocumentSessionStore()
    notebook = _notebook_model()

    room, loader = await _create_notebook_room(
        notebook, "room", session_store=session_store, document_load_progressively=False
    )
    try:
        session_a = room.session_id
        client_id_a = room._rebuild_client_id(notebook)

        # Restarting the server with progressive loading enabled rebuilds the
        # same file into different Yjs items.
        room._document_load_progressively = True
        room._assign_session(notebook, loaded_from_store=False)

        assert room.session_id != session_a
        # The rebuilds must also occupy disjoint Yjs coordinates.
        assert room._rebuild_client_id(notebook) != client_id_a
    finally:
        await room.stop()
        await loader.clean()


async def test_key_order_change_rolls_session():
    """Reordered keys rebuild to different items, so the lineage differs."""
    session_store = DocumentSessionStore()
    notebook = _notebook_model()
    notebook["metadata"] = {"a": 1, "b": 2}

    room_a, loader_a = await _create_notebook_room(notebook, "room", session_store=session_store)
    session_a = room_a.session_id
    await room_a.stop()
    await loader_a.clean()

    reordered = deepcopy(notebook)
    reordered["metadata"] = {"b": 2, "a": 1}
    room_b, loader_b = await _create_notebook_room(reordered, "room", session_store=session_store)
    try:
        assert room_b.session_id != session_a
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_empty_notebook_rebuild_is_never_deterministic():
    """An empty notebook gets a cell with a random id synthesized on load."""
    session_store = DocumentSessionStore()
    notebook = _notebook_model()
    notebook["cells"] = []

    room_a, loader_a = await _create_notebook_room(notebook, "room", session_store=session_store)
    session_a = room_a.session_id
    try:
        session = session_store.get("room")
        assert session is not None
        assert session.rebuild_hash is None
    finally:
        await room_a.stop()
        await loader_a.clean()

    room_b, loader_b = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert room_b.session_id != session_a
        assert room_b._rebuild_client_id(notebook) != room_a._rebuild_client_id(notebook)
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_rebuild_client_ids_are_marked_and_representable():
    marker = DocumentRoom._REBUILD_CLIENT_MARKER
    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "room")
    try:
        ids = [room._rebuild_client_id(notebook), room._rebuild_client_id(notebook)]
        # Deterministic content is content-addressed: stable across rebuilds,
        # which keeps reconnecting clients idempotent.
        assert ids[0] == ids[1]
        for client_id in ids:
            assert client_id & marker
            # Must stay exactly representable as a JSON number in the browser.
            assert client_id < 2**53

        changed = deepcopy(notebook)
        changed["cells"][0]["source"] = "changed"
        assert room._rebuild_client_id(changed) != ids[0]

        # Non-deterministic content must never reuse coordinates.
        idless = deepcopy(notebook)
        del idless["cells"][0]["id"]
        random_ids = {room._rebuild_client_id(idless) for _ in range(5)}
        assert len(random_ids) == 5
        assert all(client_id & marker and client_id < 2**53 for client_id in random_ids)
    finally:
        await room.stop()
        await loader.clean()


# ---------------------------------------------------------------------------
# A kept session must imply the lineage never advanced
# ---------------------------------------------------------------------------


async def test_saving_prevents_a_later_identical_rebuild_from_keeping_the_session():
    """A file reverted to the founding content is a *different* lineage.

    Once the room saved different content, clients hold history the file no
    longer reflects; letting them rejoin silently would push the content the
    file was reverted away from straight back to disk.
    """
    session_store = DocumentSessionStore()
    notebook = _notebook_model()

    room_a, loader_a = await _create_notebook_room(notebook, "room", session_store=session_store)
    session_a = room_a.session_id
    try:
        assert session_store.get("room").rebuild_hash is not None
        # The room writes different content: the lineage advances past its
        # founding rebuild, even though the file may later be reverted to it.
        changed = deepcopy(notebook)
        changed["cells"][0]["source"] = "edited"
        room_a._note_content_written(changed)
        assert session_store.get("room").rebuild_hash is None
    finally:
        await room_a.stop()
        await loader_a.clean()

    # The file now holds exactly the founding content again.
    room_b, loader_b = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert room_b.session_id != session_a
    finally:
        await room_b.stop()
        await loader_b.clean()


async def test_saving_changed_content_marks_the_lineage_as_advanced():
    session_store = DocumentSessionStore()
    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert session_store.get("room").rebuild_hash is not None
        room._document.set_cell(0, {"cell_type": "code", "id": "cell-1", "source": "edited"})
        await room._maybe_save_document(None, save_now=True)
        assert session_store.get("room").rebuild_hash is None
    finally:
        await room.stop()
        await loader.clean()


async def test_saving_identical_content_keeps_the_lineage():
    """Saves are not gated on the content having changed, and a write-back of
    the founding content must not cost clients their silent reconnect."""
    session_store = DocumentSessionStore()
    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        founding_hash = session_store.get("room").rebuild_hash
        await room._maybe_save_document(None, save_now=True)
        assert session_store.get("room").rebuild_hash == founding_hash
    finally:
        await room.stop()
        await loader.clean()


async def test_adopting_an_out_of_band_change_advances_the_lineage():
    """The file watcher and a save that lost a race both take the file's
    content into the room; either way the lineage stops being its founding
    rebuild, and the new hash has to reach the clients."""
    session_store = DocumentSessionStore()
    notebook = _notebook_model()
    room, loader = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        assert session_store.get("room").rebuild_hash is not None
        changed = deepcopy(notebook)
        changed["cells"][0]["source"] = "changed out of band"
        await room._adopt_file_content({"content": changed, "hash": "hash-after"})

        assert session_store.get("room").rebuild_hash is None
        assert room._document.hash == "hash-after"
        assert room._document.dirty is False
    finally:
        await room.stop()
        await loader.clean()


async def test_room_publishes_the_hash_of_the_loaded_content():
    """Without this the client cannot tell its unsaved edits from an
    out-of-band change, and has to prompt for a conflict that is not one."""
    room, loader = await _create_notebook_room(_notebook_model(), "room")
    try:
        assert room._document.hash == "fake_hash"
    finally:
        await room.stop()
        await loader.clean()


async def test_a_rolled_session_implies_disjoint_coordinates():
    """Clients reconcile a rolled session by tombstoning their content.

    That is only harmless while the items they delete cannot exist in the
    new lineage, so a roll must always change the rebuild client id - even
    when the content it rebuilds from is byte-identical (the file having
    been reverted to what founded the previous lineage).
    """
    session_store = DocumentSessionStore()
    notebook = _notebook_model()

    room, loader = await _create_notebook_room(notebook, "room", session_store=session_store)
    try:
        kept_id = room._rebuild_client_id(notebook)
        # Same session, same content: the replay must stay idempotent.
        assert room._rebuild_client_id(notebook) == kept_id

        # The lineage advances and the file is later reverted, so the very
        # same content is rebuilt under a new session.
        room._note_content_written({"changed": True})
        room._assign_session(notebook, loaded_from_store=False)

        assert room._rebuild_client_id(notebook) != kept_id
    finally:
        await room.stop()
        await loader.clean()


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
        assert empty_store.get(room_id).session_id == session_a
    finally:
        await room_b.stop()
        await loader_b.clean()
        await ystore_b.stop()


def test_invalidate_rebuild_is_persisted_and_idempotent(tmp_path):
    path = tmp_path / "doc_sessions.json"
    store = DocumentSessionStore(path=path)
    store.roll("room", "rebuild", rebuild_hash="abc")
    store.invalidate_rebuild("room")
    store.invalidate_rebuild("room")
    store.invalidate_rebuild("unknown-room")
    assert DocumentSessionStore(path=path).get("room").rebuild_hash is None


def test_persist_is_atomic_and_leaves_no_temporary_files(tmp_path):
    path = tmp_path / "doc_sessions.json"
    store = DocumentSessionStore(path=path)
    store.get_or_create("room", "rest")
    store.roll("room", "rebuild", rebuild_hash="abc")
    assert [p.name for p in tmp_path.glob("*.tmp")] == []


def test_persist_failure_keeps_the_previous_store(tmp_path, monkeypatch):
    path = tmp_path / "doc_sessions.json"
    store = DocumentSessionStore(path=path)
    session_id = store.get_or_create("room", "rest")

    def _boom(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr("jupyter_server_ydoc.sessions.os.replace", _boom)
    store.roll("room", "rebuild", rebuild_hash="abc")

    # The store on disk is still the last complete one, not a truncated file.
    assert DocumentSessionStore(path=path).get("room").session_id == session_id
    assert [p.name for p in tmp_path.glob("*.tmp")] == []

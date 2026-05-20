# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import asyncio
import json

from jupyter_server_ydoc.utils import (
    YDOC_SERVER_VERSION,
    _get_jupyter_session_store,
    check_session_compatibility,
    save_current_session,
)


async def test_allows_reconnect_same_dir_same_version(tmp_path):
    await save_current_session(str(tmp_path), "old-session", YDOC_SERVER_VERSION, asyncio.Lock())
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert cannot_reconnect is False
    assert reason == ""


async def test_rejects_reconnect_version_mismatch(tmp_path):
    await save_current_session(str(tmp_path), "old-session", "0.0.1", asyncio.Lock())
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert cannot_reconnect is True
    assert reason == "version_mismatch"


async def test_rejects_reconnect_different_directory(tmp_path):
    other_dir = tmp_path / "other"
    other_dir.mkdir()
    await save_current_session(str(other_dir), "old-session", YDOC_SERVER_VERSION, asyncio.Lock())
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert cannot_reconnect is True
    # Since it cannot find .jupyter folder or the session ID if folder is present
    assert reason == "unknown_session"


def test_rejects_unknown_session(tmp_path):
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path), "never-seen-session", YDOC_SERVER_VERSION
    )
    assert cannot_reconnect is True
    assert reason == "unknown_session"


async def test_allows_reconnect_with_document_version(tmp_path):
    """Test that document version is saved and validated correctly."""
    doc_version = "2.1.0"
    await save_current_session(
        str(tmp_path),
        "doc-session",
        YDOC_SERVER_VERSION,
        asyncio.Lock(),
        document_version=doc_version,
    )
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path),
        "doc-session",
        YDOC_SERVER_VERSION,
        current_document_version=doc_version,
    )
    assert cannot_reconnect is False
    assert reason == ""


async def test_rejects_reconnect_document_version_mismatch(tmp_path):
    """Test that document version mismatch is detected."""
    old_doc_version = "2.0.0"
    new_doc_version = "2.1.0"
    await save_current_session(
        str(tmp_path),
        "doc-session",
        YDOC_SERVER_VERSION,
        asyncio.Lock(),
        document_version=old_doc_version,
    )
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path),
        "doc-session",
        YDOC_SERVER_VERSION,
        current_document_version=new_doc_version,
    )
    assert cannot_reconnect is True
    assert reason == "version_mismatch"


async def test_allows_reconnect_without_document_version_in_old_session(tmp_path):
    """Test backward compatibility: old sessions without document version are still allowed."""
    # Old session saved without document_version
    await save_current_session(str(tmp_path), "old-session", YDOC_SERVER_VERSION, asyncio.Lock())
    # New client has document version but old session doesn't → should allow
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path),
        "old-session",
        YDOC_SERVER_VERSION,
        current_document_version="2.1.0",
    )
    assert cannot_reconnect is False
    assert reason == ""


def test_session_store_path_override_used_when_set(tmp_path):
    """``session_store_path`` overrides the default ``.jupyter`` location."""
    override = tmp_path / "elsewhere" / "sessions.json"
    resolved = _get_jupyter_session_store(str(tmp_path), str(override))
    # The override directory is created on demand and the file path is honored as-is.
    assert resolved == override
    assert override.parent.is_dir()
    # The default location should not have been created.
    assert not (tmp_path / ".jupyter").exists()


async def test_session_store_path_override_persists_records(tmp_path):
    """Saved sessions land under the override path and reconnects honor it."""
    override = tmp_path / "elsewhere" / "sessions.json"
    await save_current_session(
        str(tmp_path),
        "override-session",
        YDOC_SERVER_VERSION,
        asyncio.Lock(),
        session_store_path=str(override),
    )

    assert override.exists()
    payload = json.loads(override.read_text())
    assert "override-session" in payload
    # The default location must remain untouched.
    assert not (tmp_path / ".jupyter" / "collaboration_sessions.json").exists()

    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path),
        "override-session",
        YDOC_SERVER_VERSION,
        session_store_path=str(override),
    )
    assert cannot_reconnect is False
    assert reason == ""


async def test_session_store_path_override_isolated_from_default(tmp_path):
    """Records saved with an override are invisible to the default lookup."""
    override = tmp_path / "elsewhere" / "sessions.json"
    await save_current_session(
        str(tmp_path),
        "override-session",
        YDOC_SERVER_VERSION,
        asyncio.Lock(),
        session_store_path=str(override),
    )

    # Without the override, the default lookup should treat the session as unknown.
    cannot_reconnect, reason = check_session_compatibility(
        str(tmp_path),
        "override-session",
        YDOC_SERVER_VERSION,
    )
    assert cannot_reconnect is True
    assert reason == "unknown_session"

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import asyncio

from jupyter_server_ydoc.utils import (
    check_session_compatibility,
    save_current_session,
    YDOC_SERVER_VERSION,
)


async def test_allows_reconnect_same_dir_same_version(tmp_path):
    await save_current_session(str(tmp_path), "old-session", YDOC_SERVER_VERSION, asyncio.Lock())
    cannot_reconnect, reason = await check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert cannot_reconnect is False
    assert reason == ""


async def test_rejects_reconnect_version_mismatch(tmp_path):
    await save_current_session(str(tmp_path), "old-session", "0.0.1", asyncio.Lock())
    cannot_reconnect, reason = await check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert cannot_reconnect is True
    assert reason == "version_mismatch"


async def test_rejects_reconnect_different_directory(tmp_path):
    other_dir = tmp_path / "other"
    other_dir.mkdir()
    await save_current_session(str(other_dir), "old-session", YDOC_SERVER_VERSION, asyncio.Lock())
    cannot_reconnect, reason = await check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert cannot_reconnect is True
    # Since it cannot find .jupyter folder or the session ID if folder is present
    assert reason == "unknown_session"


async def test_rejects_unknown_session(tmp_path):
    cannot_reconnect, reason = await check_session_compatibility(
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
    cannot_reconnect, reason = await check_session_compatibility(
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
    cannot_reconnect, reason = await check_session_compatibility(
        str(tmp_path),
        "doc-session",
        YDOC_SERVER_VERSION,
        current_document_version=new_doc_version,
    )
    assert cannot_reconnect is True
    assert reason == "document_version_mismatch"


async def test_allows_reconnect_without_document_version_in_old_session(tmp_path):
    """Test backward compatibility: old sessions without document version are still allowed."""
    # Old session saved without document_version
    await save_current_session(str(tmp_path), "old-session", YDOC_SERVER_VERSION, asyncio.Lock())
    # New client has document version but old session doesn't → should allow
    cannot_reconnect, reason = await check_session_compatibility(
        str(tmp_path),
        "old-session",
        YDOC_SERVER_VERSION,
        current_document_version="2.1.0",
    )
    assert cannot_reconnect is False
    assert reason == ""

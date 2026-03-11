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
    can_reconnect, reason = check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert can_reconnect is True
    assert reason == ""


async def test_rejects_reconnect_version_mismatch(tmp_path):
    await save_current_session(str(tmp_path), "old-session", "0.0.1", asyncio.Lock())
    can_reconnect, reason = check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert can_reconnect is False
    assert reason == "version_mismatch"


async def test_rejects_reconnect_different_directory(tmp_path):
    other_dir = tmp_path / "other"
    other_dir.mkdir()
    await save_current_session(str(other_dir), "old-session", YDOC_SERVER_VERSION, asyncio.Lock())
    can_reconnect, reason = check_session_compatibility(
        str(tmp_path), "old-session", YDOC_SERVER_VERSION
    )
    assert can_reconnect is False
    # Since it cannot find .jupyter folder or the session ID if folder is present
    assert reason == "unknown_session"


def test_rejects_unknown_session(tmp_path):
    can_reconnect, reason = check_session_compatibility(
        str(tmp_path), "never-seen-session", YDOC_SERVER_VERSION
    )
    assert can_reconnect is False
    assert reason == "unknown_session"

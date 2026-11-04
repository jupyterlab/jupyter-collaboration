# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from jupyter_server_ydoc.utils import check_document_session_compatibility


def test_allows_reconnect_when_client_sent_no_session_id():
    cannot_reconnect, reason = check_document_session_compatibility("room-session-a", "")
    assert cannot_reconnect is False
    assert reason == ""


def test_allows_reconnect_when_session_ids_match():
    cannot_reconnect, reason = check_document_session_compatibility(
        "room-session-a", "room-session-a"
    )
    assert cannot_reconnect is False
    assert reason == ""


def test_rejects_reconnect_when_session_ids_differ():
    cannot_reconnect, reason = check_document_session_compatibility(
        "room-session-a", "room-session-b"
    )
    assert cannot_reconnect is True
    assert reason == "document_session_mismatch"


def test_allows_reconnect_when_room_has_no_recorded_session():
    """Legacy documents that predate this mechanism have no recorded session yet."""
    cannot_reconnect, reason = check_document_session_compatibility(None, "room-session-a")
    assert cannot_reconnect is False
    assert reason == ""


def test_allows_reconnect_when_room_session_is_empty_string():
    """An empty-string recorded session is treated the same as None: nothing
    to compare a client's remembered session against."""
    cannot_reconnect, reason = check_document_session_compatibility("", "room-session-a")
    assert cannot_reconnect is False
    assert reason == ""

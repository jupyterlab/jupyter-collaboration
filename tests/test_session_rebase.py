# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

"""End-to-end document session reconciliation over the websocket stack.

These tests exercise the deployment shape this machinery exists for: a room
whose Yjs history is *not* carried forward, either because no YStore is
configured or - as deployments commonly do - because the YStore database is
wiped periodically. A reconnecting client must then never resynchronize onto
a history that diverged from its own without first reconciling the content.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from asyncio import Event, sleep
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Any

import pytest
from httpx_ws import WebSocketDisconnect, aconnect_ws
from jupyter_events.logger import EventLogger
from jupyter_ydoc import YUnicode
from pycrdt import Provider
from pycrdt.websocket.websocket import HttpxWebsocket

from .test_handlers import _doc_room_ws_url, _extract_ws_disconnect

if sys.version_info < (3, 11):
    # Backport of the Python 3.11 built-in; a dependency of httpx_ws (via
    # anyio), which raises such groups on Python < 3.11 in the first place.
    from exceptiongroup import BaseExceptionGroup

# Evict rooms almost immediately, so a test can take a document through
# several room incarnations without waiting a minute for each.
ROOM_EVICTION_DELAY = 0.1


@pytest.fixture
def rtc_document_cleanup_delay():
    return ROOM_EVICTION_DELAY


async def _fetch_document_session(rtc_fetch_session: Callable[..., Any], path: str) -> dict:
    resp = await rtc_fetch_session("text", "file", path)
    return json.loads(resp.body.decode("utf-8"))


async def _sync_once(url: str, room_name: str) -> str:
    """Connect, wait for the initial synchronization, return the content.

    Fails rather than hanging if the server never sends content, as a
    refused connection would otherwise wait forever.
    """
    event = Event()

    def _on_document_change(target: str, e: Any) -> None:
        if target == "source":
            event.set()

    doc = YUnicode()
    doc.observe(_on_document_change)
    async with aconnect_ws(url) as ws, Provider(doc.ydoc, HttpxWebsocket(ws, room_name)):
        await _wait_for_event(event)
        await sleep(0.1)
    return doc.source


async def _wait_for_event(event: Event, timeout: float = 10.0) -> None:
    """Wait for `event`, failing rather than hanging if it never fires.

    `asyncio.wait_for` rather than the more readable `asyncio.timeout`, which
    this project cannot use while it still supports Python 3.10.
    """
    await asyncio.wait_for(event.wait(), timeout=timeout)


async def _wait_for_file(path: Path, expected: str, timeout: float = 30.0) -> None:
    """Wait for the room to write `expected` to disk.

    The room debounces saves, so this is never immediate, and a loaded CI
    runner can take considerably longer than a local one; the budget is
    generous because the cost of it being too tight is a flaky failure.
    """
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    last = None
    while loop.time() < deadline:
        try:
            last = path.read_text()
        except OSError:
            # Windows can refuse the read while the room is mid-write.
            last = None
        if last == expected:
            return
        await sleep(0.1)
    pytest.fail(f"the room never saved {expected!r} to {path.name}, last saw {last!r}")


async def _evict_room() -> None:
    await sleep(ROOM_EVICTION_DELAY * 5)


def _wipe_ystore(jp_root_dir: Path) -> None:
    """Drop the persisted Yjs history, as a periodic cleanup job would.

    The rows are deleted rather than the database file, because the server
    holds its SQLite connection open for the lifetime of the process and
    Windows refuses to unlink a file another handle still has open. An empty
    table gives the room the same thing an absent file does: `apply_updates`
    raises `YDocNotFound`, so the room rebuilds from disk with no history.
    """
    db_path = jp_root_dir.joinpath(".rtc_test.db")
    if not db_path.exists():
        return
    with closing(sqlite3.connect(db_path, timeout=10)) as db:
        for table in ("yupdates", "ycheckpoints"):
            try:
                db.execute(f"DELETE FROM {table}")
            except sqlite3.OperationalError:
                # The store has not created this table yet.
                pass
        db.commit()


async def test_history_rebuilt_from_unchanged_file_still_rolls_the_session(
    rtc_create_file, rtc_fetch_session, jp_root_dir, jp_http_port, jp_base_url
):
    """A rebuild is a new lineage even when the file never changed.

    The rebuilt items are new, so a client holding the previous ones has to
    reconcile before resynchronizing. Its content is identical, so it does
    so silently, but it is refused first rather than merging blindly.
    """
    path, content = await rtc_create_file("kept.txt", "hello")
    session_data = await _fetch_document_session(rtc_fetch_session, path)
    doc_session = session_data["documentSessionId"]

    url, room_name = _doc_room_ws_url(jp_http_port, jp_base_url, session_data, doc_session)
    assert await _sync_once(url, room_name) == content

    await _evict_room()
    _wipe_ystore(jp_root_dir)

    with pytest.raises((WebSocketDisconnect, BaseExceptionGroup)) as exc_info:
        async with aconnect_ws(url) as ws:
            await ws.receive()
    disconnect = _extract_ws_disconnect(exc_info.value)
    assert disconnect.code == 1003
    payload = json.loads(disconnect.reason)
    assert payload["reason"] == "session_changed"
    assert payload["sessionId"] != doc_session

    # Claiming the session the server reported gets the client back in, on
    # the same content it already had.
    fresh_url, _ = _doc_room_ws_url(jp_http_port, jp_base_url, session_data, payload["sessionId"])
    assert await _sync_once(fresh_url, room_name) == content


async def test_out_of_band_change_rolls_the_session_and_refuses_stale_clients(
    rtc_create_file, rtc_fetch_session, jp_root_dir, jp_http_port, jp_base_url
):
    """The headline data-loss scenario, end to end.

    A client holding the history of the old file content must be refused
    before any synchronization happens, told which session the room moved
    to, and be able to join on that session afterwards.
    """
    path, content = await rtc_create_file("rolled.txt", "before")
    session_data = await _fetch_document_session(rtc_fetch_session, path)
    stale_session = session_data["documentSessionId"]

    stale_url, room_name = _doc_room_ws_url(jp_http_port, jp_base_url, session_data, stale_session)
    assert await _sync_once(stale_url, room_name) == content

    await _evict_room()
    _wipe_ystore(jp_root_dir)
    # The file changes while no room holds it (an external tool, a git
    # checkout, another process).
    jp_root_dir.joinpath(path).write_text("after")

    with pytest.raises((WebSocketDisconnect, BaseExceptionGroup)) as exc_info:
        async with aconnect_ws(stale_url) as ws:
            await ws.receive()

    disconnect = _extract_ws_disconnect(exc_info.value)
    assert disconnect.code == 1003
    payload = json.loads(disconnect.reason)
    assert payload["reason"] == "session_changed"
    rolled_session = payload["sessionId"]
    assert rolled_session != stale_session

    # Claiming the session the server reported gets the client back in, on
    # the content the file now holds.
    fresh_url, _ = _doc_room_ws_url(jp_http_port, jp_base_url, session_data, rolled_session)
    assert await _sync_once(fresh_url, room_name) == "after"


async def test_a_refused_client_reports_neither_joining_nor_leaving(
    rtc_create_file, rtc_fetch_session, jp_root_dir, jp_http_port, jp_base_url, jp_serverapp
):
    """A client turned away at the door never entered the room, so the
    collaborator list must not flicker for the users who are inside."""
    import uuid

    path, _ = await rtc_create_file("awareness.txt", "hello")
    session_data = await _fetch_document_session(rtc_fetch_session, path)
    url, room_name = _doc_room_ws_url(
        jp_http_port, jp_base_url, session_data, session_data["documentSessionId"]
    )
    await _sync_once(url, room_name)

    events: list[dict] = []

    async def _listener(logger: EventLogger, schema_id: str, data: dict) -> None:
        events.append(data)

    jp_serverapp.event_logger.add_listener(
        schema_id="https://schema.jupyter.org/jupyter_collaboration/awareness/v1",
        listener=_listener,
    )

    stale_url, _ = _doc_room_ws_url(jp_http_port, jp_base_url, session_data, str(uuid.uuid4()))
    with pytest.raises((WebSocketDisconnect, BaseExceptionGroup)):
        async with aconnect_ws(stale_url) as ws:
            await ws.receive()
    await sleep(0.3)

    assert [event.get("action") for event in events] == []


async def test_file_reverted_to_the_founding_content_rolls_the_session(
    rtc_create_file, rtc_fetch_session, jp_root_dir, jp_http_port, jp_base_url
):
    """A version control checkout cannot be silently undone by a client.

    Once the room has written different content to disk, clients hold history
    the file no longer reflects. Reverting the file rebuilds content which is
    byte-identical to what the room started from, but letting a client rejoin
    on that would push the content the file was reverted away from straight
    back to disk.
    """
    path, _ = await rtc_create_file("reverted.txt", "original")
    session_data = await _fetch_document_session(rtc_fetch_session, path)
    founding_session = session_data["documentSessionId"]

    url, room_name = _doc_room_ws_url(jp_http_port, jp_base_url, session_data, founding_session)

    # A client edits the document; the room saves the new content to disk.
    doc = YUnicode()
    synchronized = Event()

    def _on_document_change(target: str, e: Any) -> None:
        if target == "source":
            synchronized.set()

    doc.observe(_on_document_change)
    async with aconnect_ws(url) as ws, Provider(doc.ydoc, HttpxWebsocket(ws, room_name)):
        # The edit has to come after the initial synchronization. Writing to
        # an empty document that is still being synchronized merges the two
        # sources into something neither side asked for, which on a slow
        # runner is exactly what used to happen.
        await _wait_for_event(synchronized)
        assert doc.source == "original"

        doc.source = "edited"
        await _wait_for_file(jp_root_dir.joinpath(path), "edited")

    await _evict_room()
    _wipe_ystore(jp_root_dir)
    # The file is reverted to exactly the content which founded the session.
    jp_root_dir.joinpath(path).write_text("original")

    with pytest.raises((WebSocketDisconnect, BaseExceptionGroup)) as exc_info:
        async with aconnect_ws(url) as ws:
            await ws.receive()

    disconnect = _extract_ws_disconnect(exc_info.value)
    assert disconnect.code == 1003
    assert json.loads(disconnect.reason)["sessionId"] != founding_session

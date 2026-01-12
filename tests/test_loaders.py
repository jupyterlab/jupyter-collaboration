# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from jupyter_server_ydoc.loaders import FileLoader, FileLoaderMapping
from jupyter_server_ydoc.test_utils import FakeContentsManager, FakeFileIDManager


async def test_FileLoader_with_watcher():
    id = "file-4567"
    path = "myfile.txt"
    paths = {}
    paths[id] = path

    cm = FakeContentsManager({"last_modified": datetime.now(timezone.utc)})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
    )
    await loader.load_content("text", "file")

    triggered = False

    async def trigger():
        nonlocal triggered
        triggered = True

    loader.observe("test", trigger)

    cm.model["last_modified"] = datetime.now(timezone.utc) + timedelta(seconds=1)

    await asyncio.sleep(0.15)

    try:
        assert triggered
    finally:
        await loader.clean()


async def test_FileLoader_with_watcher_errors(caplog):
    id = "file-4567"
    path = "myfile.txt"
    paths = {}
    paths[id] = path

    cm = FakeContentsManager({"last_modified": datetime.now(timezone.utc)})

    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
        max_consecutive_logs=2,
        stop_poll_on_errors_after=1,
    )
    await loader.load_content("text", "file")

    try:
        cm.model = {}
        await asyncio.sleep(0.5)
        logs = [r.getMessage() for r in caplog.records]
        assert logs == [
            "Error watching file myfile.txt: HTTP 404: Not Found (File not found: myfile.txt)",
            "Error watching file myfile.txt: HTTP 404: Not Found (File not found: myfile.txt)",
            "Too many errors while watching myfile.txt - suppressing further logs.",
        ]

        await asyncio.sleep(1)
        logs = [r.getMessage() for r in caplog.records]
        assert len(logs) == 4
        assert (
            logs[-1]
            == "Stopping watching file due to consecutive errors over 1 seconds: myfile.txt"
        )
    finally:
        await loader.clean()


async def test_FileLoader_clean_logs_cancellation(caplog):
    id = "file-4567"
    path = "myfile.txt"
    paths = {id: path}

    cm = FakeContentsManager({"last_modified": datetime.now(timezone.utc)})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.05,
    )
    await loader.load_content("text", "file")

    caplog.set_level(logging.INFO)
    await loader.clean()

    messages = [r.getMessage() for r in caplog.records]
    assert f"File watcher for '{id}' was cancelled" in messages


async def test_FileLoader_without_watcher():
    id = "file-4567"
    path = "myfile.txt"
    paths = {}
    paths[id] = path

    cm = FakeContentsManager({"last_modified": datetime.now(timezone.utc)})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
    )
    await loader.load_content("text", "file")

    triggered = False

    async def trigger():
        nonlocal triggered
        triggered = True

    loader.observe("test", trigger)

    cm.model["last_modified"] = datetime.now(timezone.utc) + timedelta(seconds=1)

    await loader.maybe_notify()

    try:
        assert triggered
    finally:
        await loader.clean()


async def test_FileLoaderMapping_with_watcher():
    id = "file-4567"
    path = "myfile.txt"
    paths = {}
    paths[id] = path

    cm = FakeContentsManager({"last_modified": datetime.now(timezone.utc)})

    map = FileLoaderMapping(
        {"contents_manager": cm, "file_id_manager": FakeFileIDManager(paths)},
        file_poll_interval=1.0,
    )

    loader = map[id]
    await loader.load_content("text", "file")

    triggered = False

    async def trigger():
        nonlocal triggered
        triggered = True

    loader.observe("test", trigger)

    # Clear map (and its loader) before updating => triggered should be False
    await map.clear()
    cm.model["last_modified"] = datetime.now(timezone.utc)

    await asyncio.sleep(0.15)

    assert not triggered

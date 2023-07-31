# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from datetime import datetime

import pytest

from jupyter_collaboration.loaders import FileLoader, FileLoaderMapping

from .utils import FakeContentsManager, FakeFileIDManager


@pytest.mark.asyncio
async def test_FileLoader_with_watcher():
    id = "file-4567"
    path = "myfile.txt"
    paths = {}
    paths[id] = path

    cm = FakeContentsManager({"last_modified": datetime.now()})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
        poll_interval=0.1,
    )

    triggered = False

    async def trigger(*args):
        nonlocal triggered
        triggered = True

    loader.observe("test", trigger)

    cm.model["last_modified"] = datetime.now()

    await asyncio.sleep(0.15)

    try:
        assert triggered
    finally:
        await loader.clean()


@pytest.mark.asyncio
async def test_FileLoader_without_watcher():
    id = "file-4567"
    path = "myfile.txt"
    paths = {}
    paths[id] = path

    cm = FakeContentsManager({"last_modified": datetime.now()})
    loader = FileLoader(
        id,
        FakeFileIDManager(paths),
        cm,
    )

    triggered = False

    async def trigger(*args):
        nonlocal triggered
        triggered = True

    loader.observe("test", trigger)

    cm.model["last_modified"] = datetime.now()

    await loader.notify()

    try:
        assert triggered
    finally:
        await loader.clean()


@pytest.mark.asyncio
async def test_FileLoaderMapping_with_watcher():
    id = "file-4567"
    path = "myfile.txt"
    paths = {}
    paths[id] = path

    cm = FakeContentsManager({"last_modified": datetime.now()})

    map = FileLoaderMapping(
        {"contents_manager": cm, "file_id_manager": FakeFileIDManager(paths)},
        file_poll_interval=1.0,
    )

    loader = map[id]

    triggered = False

    async def trigger(*args):
        nonlocal triggered
        triggered = True

    loader.observe("test", trigger)

    # Clear map (and its loader) before updating => triggered should be False
    await map.clear()
    cm.model["last_modified"] = datetime.now()

    await asyncio.sleep(0.15)

    assert not triggered

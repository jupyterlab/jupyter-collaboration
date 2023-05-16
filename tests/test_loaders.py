# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

import pytest
from jupyter_server import _tz as tz

from jupyter_collaboration.loaders import FileLoader, FileLoaderMapping


class FakeFileIDManager:
    def __init__(self, mapping: dict[str, str]):
        self.mapping = mapping

    def get_path(self, id: str) -> str:
        return self.mapping[id]


class FakeContentsManager:
    def __init__(self, model: dict):
        self.model = {
            "name": "",
            "path": "",
            "last_modified": datetime(1970, 1, 1, 0, 0, tzinfo=tz.UTC),
            "created": datetime(1970, 1, 1, 0, 0, tzinfo=tz.UTC),
            "content": None,
            "format": None,
            "mimetype": None,
            "size": 0,
            "writable": False,
        }
        self.model.update(model)

    def get(
        self, path: str, content: bool = True, format: str | None = None, type: str | None = None
    ) -> dict:
        return self.model

    def save_content(self, model: dict[str, Any], path: str) -> dict:
        return self.model


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

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

from datetime import datetime
from typing import Any

from jupyter_server import _tz as tz


class FakeFileIDManager:
    def __init__(self, mapping: dict):
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

        self.actions: list[str] = []

    def get(
        self, path: str, content: bool = True, format: str | None = None, type: str | None = None
    ) -> dict:
        self.actions.append("get")
        return self.model

    def save(self, model: dict[str, Any], path: str) -> dict:
        self.actions.append("save")
        return self.model

    def save_content(self, model: dict[str, Any], path: str) -> dict:
        self.actions.append("save_content")
        return self.model


class FakeEventLogger:
    def emit(self, schema_id: str, data: dict) -> None:
        print(data)

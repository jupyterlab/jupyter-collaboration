# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

from logging import Logger

from .base import BaseRoom


class TransientRoom(BaseRoom):
    """A Y room for sharing state (e.g. awareness)."""

    def __init__(self, room_id: str, log: Logger | None):
        super().__init__(room_id=room_id, log=log)

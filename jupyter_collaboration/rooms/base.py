# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger

from ..stores import BaseYStore
from .yroom import YRoom


class BaseRoom(YRoom):
    def __init__(self, room_id: str, store: BaseYStore | None = None, log: Logger | None = None):
        super().__init__(ready=False, ystore=store, log=log)
        self._room_id = room_id
        self._session_id: str | None = None

    @property
    def room_id(self) -> str:
        """
        The room ID.
        """
        return self._room_id

    @property
    def session_id(self) -> str | None:
        """
        A unique identifier for the updates.

        NOTE: The session id, is a unique identifier for the updates
        that compose the Y document. If this document is destroyed, every
        client connected must replace its content with new updates otherwise
        once we initialize a new Y document, the content will be duplicated.
        """
        return self._session_id

    async def initialize(self) -> None:
        return

    async def handle_msg(self, data: bytes) -> None:
        return

    def broadcast_msg(self, msg: bytes) -> None:
        for client in self.clients:
            self._task_group.start_soon(client.send, msg)  # type: ignore[union-attr]

    async def _broadcast_updates(self):
        # FIXME should be upstreamed
        try:
            await super()._broadcast_updates()
        except asyncio.CancelledError:
            pass

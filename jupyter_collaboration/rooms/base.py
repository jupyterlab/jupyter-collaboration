# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger

from ypy_websocket.websocket_server import YRoom

from ..stores import BaseYStore


class BaseRoom(YRoom):
    def __init__(self, room_id: str, store: BaseYStore | None = None, log: Logger | None = None):
        super().__init__(ready=False, ystore=store, log=log)
        self._room_id = room_id

    @property
    def room_id(self) -> str:
        """
        The room ID.
        """
        return self._room_id

    async def initialize(self) -> None:
        return

    async def handle_msg(self, data: bytes) -> None:
        return

    def broadcast_msg(self, msg: bytes) -> None:
        for client in self.clients:
            self._task_group.start_soon(client.send, msg)

    async def _broadcast_updates(self):
        # FIXME should be upstreamed
        try:
            await super()._broadcast_updates()
        except asyncio.CancelledError:
            pass

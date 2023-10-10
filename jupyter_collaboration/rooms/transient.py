# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger

from ypy_websocket.websocket_server import YRoom


class TransientRoom(YRoom):
    """A Y room for sharing state (e.g. awareness)."""

    def __init__(self, room_id: str, log: Logger | None):
        super().__init__(log=log)

        self._room_id = room_id

    @property
    def room_id(self) -> str:
        """
        The room ID.
        """
        return self._room_id

    async def _broadcast_updates(self):
        # FIXME should be upstreamed
        try:
            await super()._broadcast_updates()
        except asyncio.CancelledError:
            pass

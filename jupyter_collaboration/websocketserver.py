# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger
from typing import Any

from tornado.websocket import WebSocketHandler
from ypy_websocket.websocket_server import WebsocketServer, YRoom
from ypy_websocket.ystore import BaseYStore

from .utils import cancel_task


class RoomNotFound(LookupError):
    pass


class JupyterWebsocketServer(WebsocketServer):
    """Ypy websocket server.

    It communicates the document updates to all clients for each room.
    """

    ypatch_nb: int
    connected_user: dict[int, str]

    def __init__(
        self,
        ystore_class: BaseYStore,
        rooms_ready: bool = True,
        auto_clean_rooms: bool = True,
        log: Logger | None = None,
    ):
        super().__init__(rooms_ready, auto_clean_rooms, log)
        self.ystore_class = ystore_class
        self.ypatch_nb = 0
        self.connected_users: dict[Any, Any] = {}
        # Async loop is not yet ready at the object instantiation
        self.monitor_task: asyncio.Task | None = None

    async def clean(self):
        await super().clean()

        if self.monitor_task is not None:
            await cancel_task(self.monitor_task)

    def room_exists(self, path: str) -> bool:
        """
        Returns true is the room exist or false otherwise.

            Parameters:
                path (str): Room ID.

            Returns:
                exists (bool): Whether the room exists or not.
        """
        return path in self.rooms

    def add_room(self, path: str, room: YRoom) -> None:
        """
        Adds a new room.

            Parameters:
                path (str): Room ID.
                room (YRoom): A room.
        """
        self.rooms[path] = room

    def get_room(self, path: str) -> YRoom:
        """
        Returns the room for the specified room ID or raises a RoomNotFound
        error if the room doesn't exist.

            Parameters:
                path (str): Room ID.

            Returns:
                room (YRoom): The room.

            Raises
                RoomNotFound
        """
        if path not in self.rooms:
            # Document rooms need a file
            raise RoomNotFound

        return self.rooms[path]

    async def serve(self, websocket: WebSocketHandler) -> None:
        # start monitoring here as the event loop is not yet available when initializing the object
        if self.monitor_task is None:
            self.monitor_task = asyncio.create_task(self._monitor())

        await super().serve(websocket)

    async def _monitor(self):
        """
        An infinite loop with a 60 seconds delay for counting the number
        of patches processed in a minute and how many clients are connected.

        #### Note:
            This method runs in a coroutine for debugging purposes.
        """
        while True:
            await asyncio.sleep(60)
            clients_nb = sum(len(room.clients) for room in self.rooms.values())
            self.log.info("Processed %s Y patches in one minute", self.ypatch_nb)
            self.log.info("Connected Y users: %s", clients_nb)
            self.ypatch_nb = 0

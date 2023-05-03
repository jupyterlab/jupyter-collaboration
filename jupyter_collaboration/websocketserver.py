# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from typing import Any

from ypy_websocket.websocket_server import WebsocketServer, YRoom


class RoomNotFound(LookupError):
    pass


class JupyterWebsocketServer(WebsocketServer):
    rooms: dict[str, YRoom]
    ypatch_nb: int
    connected_user: dict[int, str]
    background_tasks: set[asyncio.Task[Any]]

    def __init__(self, *args, **kwargs):
        self.ystore_class = kwargs.pop("ystore_class")
        self.log = kwargs["log"]
        super().__init__(*args, **kwargs)
        self.ypatch_nb = 0
        self.connected_users = {}
        self.background_tasks = set()
        self.monitor_task = asyncio.create_task(self._monitor())

    def __del__(self):
        # TODO: should we wait for any save task?
        self.log.info("Deleting all rooms.")
        for room in self.websocket_server.rooms:
            self.websocket_server.delete_room(room=room)

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

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
from logging import Logger
from typing import Any, Callable

from pycrdt import Channel
from pycrdt.store import BaseYStore
from pycrdt.websocket import WebsocketServer, YRoom


class RoomNotFound(LookupError):
    pass


def exception_logger(exception: Exception, log: Logger) -> bool:
    """A function that catches any exceptions raised in the websocket
    server and logs them.

    This protects the websocket server's task group from cancelling
    anytime an exception is raised.
    """
    log.error("Jupyter Websocket Server: ", exc_info=exception)
    return True


class JupyterWebsocketServer(WebsocketServer):
    """Ypy websocket server.

    It communicates the document updates to all clients for each room.
    """

    ypatch_nb: int
    connected_user: dict[int, str]

    def __init__(
        self,
        ystore_class: type[BaseYStore],
        rooms_ready: bool = True,
        auto_clean_rooms: bool = True,
        exception_handler: Callable[[Exception, Logger], bool] | None = None,
        log: Logger | None = None,
    ):
        super().__init__(
            rooms_ready=rooms_ready,
            auto_clean_rooms=auto_clean_rooms,
            exception_handler=exception_handler,
            log=log,
        )
        self.ystore_class = ystore_class
        self.ypatch_nb = 0
        self.connected_users: dict[Any, Any] = {}
        # Async loop is not yet ready at the object instantiation
        self.monitor_task: asyncio.Task | None = None
        self._stopping = False
        self._start_task: asyncio.Task | None = None

    @property
    def stopping(self) -> bool:
        return self._stopping

    async def clean(self):
        # TODO: should we wait for any save task?
        # FIXME some clean up should be upstreamed and the following does not
        # prevent hanging stop process - it also requires some thinking about
        # should the ystore write action be cancelled; I guess not as it could
        # results in corrupted data.
        self.log.info("Cleaning up %d room(s).", len(self.rooms))
        # Reject new WebSocket connections in YDocWebSocketHandler.prepare().
        self._stopping = True

        # Stop the server first to reject any new connections during shutdown.
        # Guard: stop() raises RuntimeError if the server was never started.
        if self.started.is_set():
            await self.stop()

        # Now disconnect existing clients so their serve() tasks complete.
        tasks: list[asyncio.Task] = []
        for room in self.rooms.values():
            for client in list(room.clients):
                tasks.extend(client._background_tasks)  # type: ignore[attr-defined]
                client._message_queue.put_nowait(b"")  # type: ignore[attr-defined]

        if self.monitor_task is not None:
            self.monitor_task.cancel()
            tasks.append(self.monitor_task)

        if tasks:
            _, pending = await asyncio.wait(tasks, timeout=3)
            if pending:
                self.log.warning("%d task(s) still pending after shutdown.", len(pending))

        # Rooms persist after client disconnect so users can reconnect without
        # a full re-sync (see auto_clean_rooms=False in app.py). On shutdown
        # we must stop them explicitly.
        for room in self.rooms.values():
            try:
                await room.stop()
            except RuntimeError as e:
                if "not running" not in str(e):
                    raise
        self.rooms.clear()

        # Await the root asyncio task so anyio's task group __aexit__ runs
        # and fires done-callbacks that clean up worker threads. Without this,
        # non-daemon WorkerThread instances block Python's threading._shutdown().
        if self._start_task is not None and not self._start_task.done():
            try:
                await asyncio.wait_for(self._start_task, timeout=2)
            except asyncio.TimeoutError:
                # Letting this propagate would be silently swallowed by
                # asyncio.wait() in stop_extension(), so we log it here.
                self.log.warning("Server start task did not complete within 2s.")

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

    async def get_room(self, path: str) -> YRoom:
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

        room = self.rooms[path]
        await self.start_room(room)
        return room

    async def serve(self, websocket: Channel) -> None:
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
            try:
                await asyncio.sleep(60)
            except asyncio.CancelledError:
                break
            clients_nb = sum(len(room.clients) for room in self.rooms.values())
            self.log.info("Processed %s Y patches in one minute", self.ypatch_nb)
            self.log.info("Connected Y users: %s", clients_nb)
            self.ypatch_nb = 0

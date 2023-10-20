# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from jupyter_server.auth import authorized
from jupyter_server.base.handlers import APIHandler, JupyterHandler
from jupyter_ydoc import ydocs as YDOCS
from tornado import web
from tornado.ioloop import IOLoop
from tornado.websocket import WebSocketHandler
from ypy_websocket.yutils import write_var_uint

from .rooms import BaseRoom, RoomManager
from .stores import BaseYStore
from .utils import (
    JUPYTER_COLLABORATION_EVENTS_URI,
    LogLevel,
    MessageType,
    RoomMessages,
    decode_file_path,
)

YFILE = YDOCS["file"]


class YDocWebSocketHandler(WebSocketHandler, JupyterHandler):
    """`YDocWebSocketHandler` uses the singleton pattern for ``WebsocketServer``,
    which is a subclass of ypy-websocket's ``WebsocketServer``.

    In ``WebsocketServer``, we expect to use a WebSocket object as follows:

    - receive messages until the connection is closed with
       ``for message in websocket: pass``.
    - send a message with `await websocket.send(message)`.

    Tornado's WebSocket API is different, so ``YDocWebSocketHandler`` needs to be adapted:

    - ``YDocWebSocketHandler`` is an async iterator, that will yield received messages.
       Messages received in Tornado's `on_message(message)` are put in an async
       ``_message_queue``, from which we get them asynchronously.
    - The ``send(message)`` method is async and calls Tornado's ``write_message(message)``.
    - Although it's currently not used in ypy-websocket, ``recv()`` is an async method for
       receiving a message.
    """

    _room_id: str
    room: BaseRoom
    _serve_task: asyncio.Task | None
    _message_queue: asyncio.Queue[Any]

    def initialize(
        self,
        store: BaseYStore,
        room_manager: RoomManager,
        document_cleanup_delay: float | None = 60.0,
    ) -> None:
        super().initialize()
        # File ID manager cannot be passed as argument as the extension may load after this one
        self._file_id_manager = self.settings["file_id_manager"]

        self._store = store
        self._room_manager = room_manager
        self._cleanup_delay = document_cleanup_delay

        self._serve_task: asyncio.Task | None = None
        self._message_queue = asyncio.Queue()

    async def prepare(self):
        # NOTE: Initialize in the ExtensionApp.start_extension once
        # https://github.com/jupyter-server/jupyter_server/issues/1329
        # is done.
        # We are temporarily initializing the store here because the
        # initialization is async
        if not self._store.initialized:
            await self._store.initialize()

        return await super().prepare()

    @property
    def path(self):
        """
        Returns the room id. It needs to be called 'path' for compatibility with
        the WebsocketServer (websocket.path).
        """
        return self._room_id

    @property
    def max_message_size(self):
        """
        Override max_message size to 1GB
        """
        return 1024 * 1024 * 1024

    def __aiter__(self):
        # needed to be compatible with WebsocketServer (async for message in websocket)
        return self

    async def __anext__(self):
        # needed to be compatible with WebsocketServer (async for message in websocket)
        message = await self._message_queue.get()
        if not message:
            raise StopAsyncIteration()
        return message

    async def get(self, *args, **kwargs):
        """
        Overrides default behavior to check whether the client is authenticated or not.
        """
        if self.current_user is None:
            self.log.warning("Couldn't authenticate WebSocket connection")
            raise web.HTTPError(403)
        return await super().get(*args, **kwargs)

    async def open(self, room_id):
        """
        On connection open.
        """
        self._room_id = self.request.path.split("/")[-1]
        self.log.info("New client connecting to room: %s", self._room_id)

        try:
            # Get room
            self.room = await self._room_manager.get_room(self._room_id)

        except Exception as e:
            _, _, file_id = decode_file_path(self._room_id)
            path = self._file_id_manager.get_path(file_id)

            # Close websocket and propagate error.
            if isinstance(e, web.HTTPError):
                self.log.error(f"File {path} not found.\n{e!r}", exc_info=e)
                self.close(4000, f"File {path} not found.")
            else:
                self.log.error(f"Error initializing: {path}\n{e!r}", exc_info=e)
                self.close(4001, f"Error initializing: {path}. You need to close the document.")

            # Clean up the room and delete the file loader
            if self.room is not None and len(self.room.clients) == 0 or self.room.clients == [self]:
                self._message_queue.put_nowait(b"")
                if self._serve_task:
                    self._serve_task.cancel()
                await self._room_manager.remove_room(self._room_id)

            return

        # Close the connection if the document session expired
        session_id = self.get_query_argument("sessionId", None)
        if session_id is not None and session_id != self.room.session_id:
            self.log.error(
                f"Client tried to connect to {self._room_id} with an expired session ID {session_id}."
            )
            self.close(
                4002,
                f"Document session {session_id} expired. You need to reload this browser tab.",
            )
        elif session_id is None and self.room.session_id is not None:
            # If session_id is None is because is a new document
            # send the new session token
            data = self.room.session_id.encode("utf8")
            await self.send(
                bytes([MessageType.ROOM, RoomMessages.SESSION_TOKEN])
                + write_var_uint(len(data))
                + data
            )

        # Start processing messages in the room
        self._serve_task = asyncio.create_task(self.room.serve(self))
        self._emit(LogLevel.INFO, "initialize", "New client connected.")

    async def send(self, message):
        """
        Send a message to the client.
        """
        # needed to be compatible with WebsocketServer (websocket.send)
        try:
            self.write_message(message, binary=True)
        except Exception as e:
            self.log.debug("Failed to write message", exc_info=e)

    async def recv(self):
        """
        Receive a message from the client.
        """
        message = await self._message_queue.get()
        return message

    async def on_message(self, message):
        """
        On message receive.
        """
        message_type = message[0]

        if message_type == MessageType.ROOM:
            await self.room.handle_msg(message[1:])

        if message_type == MessageType.CHAT:
            msg = message[2:].decode("utf-8")

            user = self.current_user
            data = json.dumps(
                {"sender": user.username, "timestamp": time.time(), "content": json.loads(msg)}
            ).encode("utf8")

            self.room.broadcast_msg(bytes([MessageType.CHAT]) + write_var_uint(len(data)) + data)

        self._message_queue.put_nowait(message)

    def on_close(self) -> None:
        """
        On connection close.
        """
        # stop serving this client
        self._message_queue.put_nowait(b"")

        if self._serve_task is not None and not self._serve_task.cancelled():
            self._serve_task.cancel()

        if self.room is not None:
            # Remove it self from the list of clients
            self.room.clients.remove(self)
            if len(self.room.clients) == 0:
                # no client in this room after we disconnect
                # Remove the room with a delay in case someone reconnects
                IOLoop.current().add_callback(
                    self._room_manager.remove_room, self._room_id, self._cleanup_delay
                )

    def _emit(self, level: LogLevel, action: str | None = None, msg: str | None = None) -> None:
        if self._room_id.count(":") < 2:
            return

        _, _, file_id = decode_file_path(self._room_id)
        path = self._file_id_manager.get_path(file_id)

        data = {"level": level.value, "room": self._room_id, "path": path}
        if action:
            data["action"] = action
        if msg:
            data["msg"] = msg

        self.event_logger.emit(schema_id=JUPYTER_COLLABORATION_EVENTS_URI, data=data)

    def check_origin(self, origin):
        """
        Check origin
        """
        return True


class DocSessionHandler(APIHandler):
    """
    Jupyter Server's handler to retrieve the document's session.
    """

    auth_resource = "contents"

    def initialize(self, store: BaseYStore, room_manager: RoomManager) -> None:
        super().initialize()
        self._store = store
        self._room_manager = room_manager

    async def prepare(self):
        # NOTE: Initialize in the ExtensionApp.start_extension once
        # https://github.com/jupyter-server/jupyter_server/issues/1329
        # is done.
        # We are temporarily initializing the store here because the
        # initialization is async
        if not self._store.initialized:
            await self._store.initialize()

        return await super().prepare()

    @web.authenticated
    @authorized
    async def put(self, path):
        """
        Creates a new session for a given document or returns an existing one.
        """
        body = json.loads(self.request.body)
        format = body["format"]
        content_type = body["type"]
        file_id_manager = self.settings["file_id_manager"]

        status = 200
        idx = file_id_manager.get_id(path)
        if idx is None:
            # try indexing
            status = 201
            idx = file_id_manager.index(path)
            if idx is None:
                # file does not exists
                raise web.HTTPError(404, f"File {path!r} does not exist")

        session_id = await self._get_session_id(f"{format}:{content_type}:{idx}")

        self.log.info("Request for Y document '%s' with room ID: %s", path, idx)
        data = json.dumps(
            {"format": format, "type": content_type, "fileId": idx, "sessionId": session_id}
        )
        self.set_status(status)
        return self.finish(data)

    async def _get_session_id(self, room_id: str) -> str | None:
        # If the room exists and it is ready, return the session_id from the room.
        if self._room_manager.has_room(room_id):
            room = await self._room_manager.get_room(room_id)
            if room.ready:
                return room.session_id

        if await self._store.exists(room_id):
            doc = await self._store.get(room_id)
            if doc is not None and "session_id" in doc:
                return doc["session_id"]

        return None

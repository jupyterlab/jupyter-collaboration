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
from pycrdt_websocket.websocket_server import YRoom
from pycrdt_websocket.ystore import BaseYStore
from pycrdt_websocket.yutils import YMessageType, write_var_uint
from tornado import web
from tornado.ioloop import IOLoop
from tornado.websocket import WebSocketHandler

from .rooms import BaseRoom, RoomManager
from .stores import BaseYStore
from .utils import (
    JUPYTER_COLLABORATION_AWARENESS_EVENTS_URI,
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
    _background_tasks: set[asyncio.Task]
    _room_locks: dict[str, asyncio.Lock] = {}

    def _room_lock(self, room_id: str) -> asyncio.Lock:
        if room_id not in self._room_locks:
            self._room_locks[room_id] = asyncio.Lock()
        return self._room_locks[room_id]

    def create_task(self, aw):
        task = asyncio.create_task(aw)
        self._background_tasks.add(task)
        task.add_done_callback(self._background_tasks.discard)

    async def prepare(self):
        if not self._websocket_server.started.is_set():
            self.create_task(self._websocket_server.start())
            await self._websocket_server.started.wait()

        # Get room
        self._room_id: str = self.request.path.split("/")[-1]

        async with self._room_lock(self._room_id):
            if self._websocket_server.room_exists(self._room_id):
                self.room: YRoom = await self._websocket_server.get_room(self._room_id)
            else:
                if self._room_id.count(":") >= 2:
                    # DocumentRoom
                    file_format, file_type, file_id = decode_file_path(self._room_id)
                    if file_id in self._file_loaders:
                        self._emit(
                            LogLevel.WARNING,
                            None,
                            "There is another collaborative session accessing the same file.\nThe synchronization between rooms is not supported and you might lose some of your changes.",
                        )

                    file = self._file_loaders[file_id]
                    updates_file_path = f".{file_type}:{file_id}.y"
                    ystore = self._ystore_class(path=updates_file_path, log=self.log)
                    self.room = DocumentRoom(
                        self._room_id,
                        file_format,
                        file_type,
                        file,
                        self.event_logger,
                        ystore,
                        self.log,
                        self._document_save_delay,
                    )

                else:
                    # TransientRoom
                    # it is a transient document (e.g. awareness)
                    self.room = TransientRoom(self._room_id, self.log)

            await self._websocket_server.start_room(self.room)
            self._websocket_server.add_room(self._room_id, self.room)

        res = super().prepare()
        if res is not None:
            return await res

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

            try:
                # Initialize the room
                async with self._room_lock(self._room_id):
                    await self.room.initialize()
                self._emit_awareness_event(self.current_user.username, "join")
            except Exception as e:
                _, _, file_id = decode_file_path(self._room_id)
                file = self._file_loaders[file_id]

            # Clean up the room and delete the file loader
            if self.room is not None and len(self.room.clients) == 0 or self.room.clients == [self]:
                self._message_queue.put_nowait(b"")
                if self._serve_task:
                    self._serve_task.cancel()
                await self._room_manager.remove_room(self._room_id)

            return

            self._emit(LogLevel.INFO, "initialize", "New client connected.")
        else:
            if self.room.room_id != "JupyterLab:globalAwareness":
                self._emit_awareness_event(self.current_user.username, "join")

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

        if message_type == YMessageType.AWARENESS:
            # awareness
            skip = False
            changes = self.room.awareness.get_changes(message[1:])
            added_users = changes["added"]
            removed_users = changes["removed"]
            for i, user in enumerate(added_users):
                u = changes["states"][i]
                if "user" in u:
                    name = u["user"]["name"]
                    self._websocket_server.connected_users[user] = name
                    self.log.debug("Y user joined: %s", name)
            for user in removed_users:
                if user in self._websocket_server.connected_users:
                    name = self._websocket_server.connected_users[user]
                    del self._websocket_server.connected_users[user]
                    self.log.debug("Y user left: %s", name)
            # filter out message depending on changes
            if skip:
                self.log.debug(
                    "Filtered out Y message of type: %s",
                    YMessageType(message_type).name,
                )
                return skip

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
        if isinstance(self.room, DocumentRoom) and self.room.clients == [self]:
            # no client in this room after we disconnect
            # keep the document for a while in case someone reconnects
            self.log.info("Cleaning room: %s", self._room_id)
            self.room.cleaner = asyncio.create_task(self._clean_room())
        if self.room.room_id != "JupyterLab:globalAwareness":
            self._emit_awareness_event(self.current_user.username, "leave")

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

    def _emit_awareness_event(self, username: str, action: str, msg: str | None = None) -> None:
        data = {"roomid": self._room_id, "username": username, "action": action}
        if msg:
            data["msg"] = msg

        self.event_logger.emit(schema_id=JUPYTER_COLLABORATION_AWARENESS_EVENTS_URI, data=data)

    async def _clean_room(self) -> None:
        """
        Async task for cleaning up the resources.

        When all the clients of a room leave, we setup a task to clean up the resources
        after a certain amount of time. We need to wait a few seconds to clean up the room
        because sometimes websockets unintentionally disconnect.

        During the clean up, we need to delete the room to free resources since the room
        contains a copy of the document. In addition, we remove the file if there is no rooms
        subscribed to it.
        """
        assert isinstance(self.room, DocumentRoom)

        if self._cleanup_delay is None:
            return

        await asyncio.sleep(self._cleanup_delay)

        async with self._room_lock(self._room_id):
            # Remove the room from the websocket server
            self.log.info("Deleting Y document from memory: %s", self.room.room_id)
            self._websocket_server.delete_room(room=self.room)

            # Clean room
            del self.room
            self.log.info("Room %s deleted", self._room_id)
            self._emit(LogLevel.INFO, "clean", "Room deleted.")

            # Clean the file loader if there are not rooms using it
            _, _, file_id = decode_file_path(self._room_id)
            file = self._file_loaders[file_id]
            if file.number_of_subscriptions == 0:
                self.log.info("Deleting file %s", file.path)
                await self._file_loaders.remove(file_id)
                self._emit(LogLevel.INFO, "clean", "Loader deleted.")
            del self._room_locks[self._room_id]

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

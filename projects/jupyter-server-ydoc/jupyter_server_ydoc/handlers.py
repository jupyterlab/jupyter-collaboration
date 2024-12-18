# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import asyncio
import json
import time
import uuid
from logging import Logger
from typing import Any, Literal
from uuid import uuid4

from jupyter_server.auth import authorized
from jupyter_server.base.handlers import APIHandler, JupyterHandler
from jupyter_server.utils import ensure_async
from jupyter_ydoc import ydocs as YDOCS
from pycrdt import Doc, UndoManager, write_var_uint
from pycrdt_websocket.websocket_server import YRoom
from pycrdt_websocket.ystore import BaseYStore
from tornado import web
from tornado.websocket import WebSocketHandler

from .loaders import FileLoaderMapping
from .rooms import DocumentRoom, TransientRoom
from .utils import (
    JUPYTER_COLLABORATION_AWARENESS_EVENTS_URI,
    JUPYTER_COLLABORATION_EVENTS_URI,
    JUPYTER_COLLABORATION_FORK_EVENTS_URI,
    LogLevel,
    MessageType,
    decode_file_path,
    encode_file_path,
    room_id_from_encoded_path,
)
from .websocketserver import JupyterWebsocketServer, RoomNotFound

YFILE = YDOCS["file"]


SERVER_SESSION = str(uuid.uuid4())
FORK_DOCUMENTS = {}
FORK_ROOMS: dict[str, dict[str, str]] = {}


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
        await ensure_async(super().prepare())
        if not self._websocket_server.started.is_set():
            self.create_task(self._websocket_server.start())
            await self._websocket_server.started.wait()

        # Get room
        self._room_id: str = room_id_from_encoded_path(self.request.path)

        async with self._room_lock(self._room_id):
            if self._websocket_server.room_exists(self._room_id):
                self.room: YRoom = await self._websocket_server.get_room(self._room_id)
            else:
                # Logging exceptions, instead of raising them here to ensure
                # that the y-rooms stay alive even after an exception is seen.
                def exception_logger(exception: Exception, log: Logger) -> bool:
                    """A function that catches any exceptions raised in the websocket
                    server and logs them.

                    The protects the y-room's task group from cancelling
                    anytime an exception is raised.
                    """
                    log.error(
                        f"Document Room Exception, (room_id={self._room_id or 'unknown'}): ",
                        exc_info=exception,
                    )
                    return True

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
                        exception_handler=exception_logger,
                        save_delay=self._document_save_delay,
                    )

                else:
                    # TransientRoom
                    # it is a transient document (e.g. awareness)
                    self.room = TransientRoom(
                        self._room_id,
                        log=self.log,
                        exception_handler=exception_logger,
                    )

                    if self._room_id == "JupyterLab:globalAwareness":
                        # Listen for the changes in GlobalAwareness to update users
                        self.room.awareness.observe(self._on_global_awareness_event)

            try:
                await self._websocket_server.start_room(self.room)
            except Exception as e:
                self.log.error("Room %s failed to start on websocket server", self._room_id)
                # Clean room
                await self.room.stop()
                self.log.info("Room %s deleted", self._room_id)
                self._emit(LogLevel.INFO, "clean", "Room deleted.")

                # Clean the file loader in file loader mapping if there are not any rooms using it
                _, _, file_id = decode_file_path(self._room_id)
                file = self._file_loaders[file_id]
                if file.number_of_subscriptions == 0 or (
                    file.number_of_subscriptions == 1 and self._room_id in file._subscriptions
                ):
                    self.log.info("Deleting file %s", file.path)
                    await self._file_loaders.remove(file_id)
                    self._emit(LogLevel.INFO, "clean", "file loader removed.")
                raise e
            self._websocket_server.add_room(self._room_id, self.room)

    def initialize(
        self,
        ywebsocket_server: JupyterWebsocketServer,
        file_loaders: FileLoaderMapping,
        ystore_class: type[BaseYStore],
        document_cleanup_delay: float | None = 60.0,
        document_save_delay: float | None = 1.0,
    ) -> None:
        self._background_tasks = set()
        # File ID manager cannot be passed as argument as the extension may load after this one
        self._file_id_manager = self.settings["file_id_manager"]
        self._file_loaders = file_loaders
        self._ystore_class = ystore_class
        self._cleanup_delay = document_cleanup_delay
        self._document_save_delay = document_save_delay
        self._websocket_server = ywebsocket_server
        self._message_queue = asyncio.Queue()
        self._room_id = ""
        self.room = None

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
        self.create_task(self._websocket_server.serve(self))

        if isinstance(self.room, DocumentRoom):
            # Close the connection if the document session expired
            session_id = self.get_query_argument("sessionId", "")
            if SERVER_SESSION != session_id:
                self.close(
                    1003,
                    f"Document session {session_id} expired. You need to reload this browser tab.",
                )

            # cancel the deletion of the room if it was scheduled
            if self.room.cleaner is not None:
                self.room.cleaner.cancel()

            try:
                # Initialize the room
                async with self._room_lock(self._room_id):
                    await self.room.initialize()
                self._emit_awareness_event(self.current_user.username, "join")
            except Exception as e:
                _, _, file_id = decode_file_path(self._room_id)
                file = self._file_loaders[file_id]

                # Close websocket and propagate error.
                if isinstance(e, web.HTTPError):
                    self.log.error(f"File {file.path} not found.\n{e!r}", exc_info=e)
                    self.close(1004, f"File {file.path} not found.")
                else:
                    self.log.error(f"Error initializing: {file.path}\n{e!r}", exc_info=e)
                    self.close(
                        1003,
                        f"Error initializing: {file.path}. You need to close the document.",
                    )

                # Clean up the room and delete the file loader
                if len(self.room.clients) == 0 or self.room.clients == [self]:
                    self._message_queue.put_nowait(b"")
                    self._cleanup_delay = 0
                    await self._clean_room()

            self._emit(LogLevel.INFO, "initialize", "New client connected.")
        else:
            if self._room_id != "JupyterLab:globalAwareness":
                self._emit_awareness_event(self.current_user.username, "join")

    async def send(self, message):
        """
        Send a message to the client.
        """
        # needed to be compatible with WebsocketServer (websocket.send)
        try:
            self.write_message(message, binary=True)
        except Exception as e:
            self.log.error("Failed to write message", exc_info=e)

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

        if message_type == MessageType.CHAT:
            msg = message[2:].decode("utf-8")

            user = self.current_user
            data = json.dumps(
                {
                    "sender": user.username,
                    "timestamp": time.time(),
                    "content": json.loads(msg),
                }
            ).encode("utf8")

            for client in self.room.clients:
                if client != self:
                    task = asyncio.create_task(
                        client.send(bytes([MessageType.CHAT]) + write_var_uint(len(data)) + data)
                    )
                    self._websocket_server.background_tasks.add(task)
                    task.add_done_callback(self._websocket_server.background_tasks.discard)

        self._message_queue.put_nowait(message)
        self._websocket_server.ypatch_nb += 1

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
        if self._room_id != "JupyterLab:globalAwareness":
            self._emit_awareness_event(self.current_user.username, "leave")

    def _emit(self, level: LogLevel, action: str | None = None, msg: str | None = None) -> None:
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
            self.log.info("Deleting Y document from memory: %s", self._room_id)
            await self._websocket_server.delete_room(room=self.room)

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

    def _on_global_awareness_event(
        self, topic: Literal["change", "update"], changes: tuple[dict[str, Any], Any]
    ) -> None:
        """
        Update the users when the global awareness changes.

            Parameters:
                topic (str): `"update"` or `"change"` (`"change"` is triggered only if the states are modified).
                changes (tuple[dict[str, Any], Any]): The changes and the origin of the changes.
        """
        if topic != "change":
            return
        added_users = changes[0]["added"]
        removed_users = changes[0]["removed"]
        for user in added_users:
            u = self.room.awareness.states[user]
            if "user" in u:
                name = u["user"]["name"]
                self._websocket_server.connected_users[user] = name
                self.log.debug("Y user joined: %s", name)
        for user in removed_users:
            if user in self._websocket_server.connected_users:
                name = self._websocket_server.connected_users.pop(user)
                self.log.debug("Y user left: %s", name)

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

        idx = file_id_manager.get_id(path)
        if idx is not None:
            # index already exists
            self.log.info("Request for Y document '%s' with room ID: %s", path, idx)
            data = json.dumps(
                {
                    "format": format,
                    "type": content_type,
                    "fileId": idx,
                    "sessionId": SERVER_SESSION,
                }
            )
            self.set_status(200)
            return self.finish(data)

        # try indexing
        idx = file_id_manager.index(path)
        if idx is None:
            # file does not exists
            raise web.HTTPError(404, f"File {path!r} does not exist")

        # index successfully created
        self.log.info("Request for Y document '%s' with room ID: %s", path, idx)
        data = json.dumps(
            {
                "format": format,
                "type": content_type,
                "fileId": idx,
                "sessionId": SERVER_SESSION,
            }
        )
        self.set_status(201)
        return self.finish(data)


class TimelineHandler(APIHandler):
    def initialize(
        self, ystore_class: type[BaseYStore], ywebsocket_server: JupyterWebsocketServer
    ) -> None:
        self.ystore_class = ystore_class
        self.ywebsocket_server = ywebsocket_server

    async def get(self, path: str) -> None:
        idx = uuid4().hex
        file_id_manager = self.settings["file_id_manager"]
        file_id = file_id_manager.get_id(path)

        format = str(self.request.query_arguments.get("format")[0].decode("utf-8"))
        content_type = str(self.request.query_arguments.get("type")[0].decode("utf-8"))
        encoded_path = encode_file_path(format, content_type, file_id)
        try:
            room_id = room_id_from_encoded_path(encoded_path)
            room: YRoom = await self.ywebsocket_server.get_room(room_id)
            fork_ydoc = Doc()

            ydoc_factory = YDOCS.get(content_type)
            if ydoc_factory is None:
                self.set_status(404)
                self.finish(
                    {
                        "code": 404,
                        "error": f"No document factory found for content type: {content_type}",
                    }
                )
                return

            FORK_DOCUMENTS[idx] = ydoc_factory(fork_ydoc)
            undo_manager: UndoManager = FORK_DOCUMENTS[idx].undo_manager

            updates_and_timestamps = [(item[0], item[-1]) async for item in room.ystore.read()]

            result_timestamps = []

            for update, timestamp in updates_and_timestamps:
                undo_stack_len = len(undo_manager.undo_stack)
                fork_ydoc.apply_update(update)
                if len(undo_manager.undo_stack) > undo_stack_len:
                    result_timestamps.append(timestamp)

            fork_room = YRoom(ydoc=fork_ydoc)
            self.ywebsocket_server.add_room(idx, fork_room)

            data = {
                "roomId": room_id,
                "timestamps": result_timestamps,
                "forkRoom": idx,
                "sessionId": SERVER_SESSION,
            }
            self.set_status(200)
            self.finish(json.dumps(data))

        except RoomNotFound:
            self.set_status(404)
            self.finish({"code": 404, "error": "Room not found"})


class UndoRedoHandler(APIHandler):
    def initialize(self, ywebsocket_server: JupyterWebsocketServer) -> None:
        self._websocket_server = ywebsocket_server

    async def put(self, room_id):
        try:
            action = str(self.request.query_arguments.get("action")[0].decode("utf-8"))
            steps = int(self.request.query_arguments.get("steps")[0].decode("utf-8"))
            fork_room_id = str(self.request.query_arguments.get("forkRoom")[0].decode("utf-8"))

            fork_document = FORK_DOCUMENTS.get(fork_room_id)
            if not fork_document:
                self.set_status(404)
                self.log.warning(f"Fork document not found for room ID {fork_room_id}")
                return self.finish({"code": 404, "error": "Fork document not found"})

            undo_manager = fork_document.undo_manager

            if action == "undo":
                if undo_manager.can_undo():
                    await self._perform_undo_or_redo(undo_manager, "undo", steps)
                    self.set_status(200)
                    self.log.info(f"Undo operation performed in room {room_id} for {steps} steps")
                    return self.finish({"status": "undone"})
                else:
                    self.log.info(f"No more undo operations available in room {room_id}")
                    return self.finish({"error": "No more undo operations available"})
            elif action == "redo":
                if undo_manager.can_redo():
                    await self._perform_undo_or_redo(undo_manager, "redo", steps)
                    self.set_status(200)
                    self.log.info(f"Redo operation performed in room {room_id} for {steps} steps")
                    return self.finish({"status": "redone"})
                else:
                    self.log.info(f"No more redo operations available in room {room_id}")
                    return self.finish({"error": "No more redo operations available"})
            elif action == "restore":
                try:
                    # Cleanup undo manager after restoration
                    await self._cleanup_undo_manager(fork_room_id)

                    self.set_status(200)
                    self.log.info(f"Document in room {room_id} restored successfully")
                    return self.finish({"code": 200, "status": "Document restored successfully"})
                except Exception as e:
                    self.log.error(f"Error during document restore in room {room_id}: {str(e)}")
                    self.set_status(500)
                    return self.finish(
                        {"code": 500, "error": "Internal server error", "message": str(e)}
                    )

        except Exception as e:
            self.log.error(f"Error during undo/redo/restore operation in room {room_id}: {str(e)}")

    async def _perform_undo_or_redo(
        self, undo_manager: UndoManager, action: str, steps: int
    ) -> None:
        for _ in range(steps):
            if action == "undo" and len(undo_manager.undo_stack) > 1:
                undo_manager.undo()

            elif action == "redo" and undo_manager.can_redo():
                undo_manager.redo()
            else:
                break

    async def _cleanup_undo_manager(self, room_id: str) -> None:
        if room_id in FORK_DOCUMENTS:
            del FORK_DOCUMENTS[room_id]
            self.log.info(f"Fork Document for {room_id} has been removed.")


class DocForkHandler(APIHandler):
    """
    Jupyter Server handler to:
    - create a fork of a root document (optionally synchronizing with the root document),
    - delete a fork of a root document (optionally merging back in the root document).
    - get fork IDs of a root document.
    """

    auth_resource = "contents"

    def initialize(
        self,
        ywebsocket_server: JupyterWebsocketServer,
    ) -> None:
        self._websocket_server = ywebsocket_server

    @web.authenticated
    @authorized
    async def get(self, root_roomid):
        """
        Returns a dictionary of fork room ID to fork room information for the given root room ID.
        """
        self.write(
            {
                fork_roomid: fork_info
                for fork_roomid, fork_info in FORK_ROOMS.items()
                if fork_info["root_roomid"] == root_roomid
            }
        )

    @web.authenticated
    @authorized
    async def put(self, root_roomid):
        """
        Creates a fork of a root document and returns its ID.
        Optionally keeps the fork in sync with the root.
        """
        fork_roomid = uuid4().hex
        try:
            root_room = await self._websocket_server.get_room(root_roomid)
        except RoomNotFound:
            self.set_status(404)
            return self.finish({"code": 404, "error": "Root room not found"})

        update = root_room.ydoc.get_update()
        fork_ydoc = Doc()
        fork_ydoc.apply_update(update)
        model = self.get_json_body()
        synchronize = model.get("synchronize", False)
        if synchronize:
            root_room.ydoc.observe(lambda event: fork_ydoc.apply_update(event.update))
        FORK_ROOMS[fork_roomid] = fork_info = {
            "root_roomid": root_roomid,
            "synchronize": synchronize,
            "title": model.get("title", ""),
            "description": model.get("description", ""),
        }
        fork_room = YRoom(ydoc=fork_ydoc)
        self._websocket_server.rooms[fork_roomid] = fork_room
        await self._websocket_server.start_room(fork_room)
        self._emit_fork_event(self.current_user.username, fork_roomid, fork_info, "create")
        data = json.dumps(
            {
                "sessionId": SERVER_SESSION,
                "fork_roomid": fork_roomid,
                "fork_info": fork_info,
            }
        )
        self.set_status(201)
        return self.finish(data)

    @web.authenticated
    @authorized
    async def delete(self, fork_roomid):
        """
        Deletes a forked document, and optionally merges it back in the root document.
        """
        fork_info = FORK_ROOMS.get(fork_roomid, None)
        if fork_info is None:
            self.set_status(404)
            return self.finish({"code": 404, "error": "Fork room not found"})
        root_roomid = fork_info["root_roomid"]
        del FORK_ROOMS[fork_roomid]
        if self.get_query_argument("merge") == "true":
            root_room = await self._websocket_server.get_room(root_roomid)
            root_ydoc = root_room.ydoc
            fork_room = await self._websocket_server.get_room(fork_roomid)
            fork_ydoc = fork_room.ydoc
            fork_update = fork_ydoc.get_update()
            root_ydoc.apply_update(fork_update)
        await self._websocket_server.delete_room(name=fork_roomid)
        self._emit_fork_event(self.current_user.username, fork_roomid, fork_info, "delete")
        self.set_status(200)

    def _emit_fork_event(
        self, username: str, fork_roomid: str, fork_info: dict[str, str], action: str
    ) -> None:
        data = {
            "username": username,
            "fork_roomid": fork_roomid,
            "fork_info": fork_info,
            "action": action,
        }
        self.event_logger.emit(schema_id=JUPYTER_COLLABORATION_FORK_EVENTS_URI, data=data)

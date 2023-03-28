# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import asyncio
import json
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Set

from jupyter_server.auth import authorized
from jupyter_server.base.handlers import APIHandler, JupyterHandler
from jupyter_server.serverapp import ServerWebApplication
from jupyter_ydoc import ydocs as YDOCS
from tornado import web
from tornado.httputil import HTTPServerRequest
from tornado.websocket import WebSocketHandler
from ypy_websocket.websocket_server import WebsocketServer, YRoom
from ypy_websocket.yutils import YMessageType

from .loaders import FileLoader
from .rooms import DocumentRoom, TransientRoom
from .utils import decode_file_path

YFILE = YDOCS["file"]

SERVER_SESSION = str(uuid.uuid4())


class RoomNotFound(Exception):
    pass


class JupyterWebsocketServer(WebsocketServer):
    rooms: Dict[str, YRoom]
    ypatch_nb: int
    connected_user: Dict[int, str]
    background_tasks: Set[asyncio.Task[Any]]

    def __init__(self, *args, **kwargs):
        self.ystore_class = kwargs.pop("ystore_class")
        self.log = kwargs["log"]
        super().__init__(*args, **kwargs)
        self.ypatch_nb = 0
        self.connected_users = {}
        self.background_tasks = set()
        self.monitor_task = asyncio.create_task(self.monitor())

    async def monitor(self):
        while True:
            await asyncio.sleep(60)
            clients_nb = sum(len(room.clients) for room in self.rooms.values())
            self.log.info("Processed %s Y patches in one minute", self.ypatch_nb)
            self.log.info("Connected Y users: %s", clients_nb)
            self.ypatch_nb = 0

    def room_exists(self, path: str) -> bool:
        return path in self.rooms.keys()

    def add_room(self, path: str, room: YRoom) -> None:
        self.rooms[path] = room

    def get_room(self, path: str) -> YRoom:
        if path not in self.rooms:
            # Document rooms need a file
            raise RoomNotFound

        return self.rooms[path]


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

    files: Dict[str, FileLoader] = {}
    websocket_server: Optional[JupyterWebsocketServer] = None
    _message_queue: "asyncio.Queue[Any]"

    def __init__(
        self, app: ServerWebApplication, request: HTTPServerRequest, **kwargs: Dict[str, Any]
    ):
        super().__init__(app, request, **kwargs)

        # CONFIG
        self._file_id_manager = self.settings["file_id_manager"]
        self._ystore_class = self.settings["collaborative_ystore_class"]
        self._cleanup_delay = self.settings["collaborative_document_cleanup_delay"]
        # self.settings["collaborative_file_poll_interval"]
        # self.settings["collaborative_document_save_delay"]

        # Instantiate the JupyterWebsocketServer as a Class property
        # if it doesn't exist yet
        if self.websocket_server is None:
            for k, v in self.config.get(self._ystore_class.__name__, {}).items():
                setattr(self._ystore_class, k, v)

            YDocWebSocketHandler.websocket_server = JupyterWebsocketServer(
                rooms_ready=False,
                auto_clean_rooms=False,
                ystore_class=self._ystore_class,
                log=self.log,
            )

        assert self.websocket_server is not None
        self._message_queue = asyncio.Queue()

        # Get room
        self._room_id: str = request.path.split("/")[-1]

        if self.websocket_server.room_exists(self._room_id):
            self.room: YRoom = self.websocket_server.get_room(self._room_id)

        else:
            if self._room_id.count(":") >= 2:
                # DocumentRoom
                file_format, file_type, file_id = decode_file_path(self._room_id)
                self._path = self._file_id_manager.get_path(file_id)

                # Instantiate the FileLoader if it doesn't exist yet
                file = YDocWebSocketHandler.files.get(self._path)
                if file is None:
                    self.log.info("Creating FileLoader for: %s", self._path)
                    file = FileLoader(
                        self._path,
                        file_format,
                        file_type,
                        self.contents_manager,
                        self.log,
                        self.settings["collaborative_file_poll_interval"],
                    )
                    self.files[self._path] = file

                path = Path(self._path)
                updates_file_path = str(path.parent / f".{file_type}:{path.name}.y")
                ystore = self._ystore_class(path=updates_file_path, log=self.log)
                self.room = DocumentRoom(
                    self._room_id,
                    file_format,
                    file_type,
                    file,
                    ystore,
                    self.log,
                    self.settings["collaborative_document_save_delay"],
                )

            else:
                # TransientRoom
                # it is a transient document (e.g. awareness)
                self.room = TransientRoom(self._room_id, self.log)

            self.websocket_server.add_room(self._room_id, self.room)

    @property
    def path(self):
        # needed to be compatible with WebsocketServer (websocket.path)
        return self._room_id

    # Override max_message size to 1GB
    @property
    def max_message_size(self):
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
        if self.get_current_user() is None:
            self.log.warning("Couldn't authenticate WebSocket connection")
            raise web.HTTPError(403)
        return await super().get(*args, **kwargs)

    async def open(self, path):
        assert self.websocket_server is not None

        task = asyncio.create_task(self.websocket_server.serve(self))
        self.websocket_server.background_tasks.add(task)
        task.add_done_callback(self.websocket_server.background_tasks.discard)

        if isinstance(self.room, DocumentRoom):
            # Close the connection if the document session expired
            session_id = self.get_query_argument("sessionId", "")
            if SERVER_SESSION != session_id:
                self.close(1003, f"Document session {session_id} expired")

            # cancel the deletion of the room if it was scheduled
            if self.room.cleaner is not None:
                self.room.cleaner.cancel()

            # Initialize the room
            async with self.room.lock:
                if not self.room.ready:
                    await self.room.initialize()

    async def send(self, message):
        # needed to be compatible with WebsocketServer (websocket.send)
        try:
            self.write_message(message, binary=True)
        except Exception as e:
            self.log.debug("Failed to write message", exc_info=e)

    async def recv(self):
        message = await self._message_queue.get()
        return message

    def on_message(self, message):
        assert self.websocket_server is not None
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
                    self.websocket_server.connected_users[user] = name
                    self.log.debug("Y user joined: %s", name)
            for user in removed_users:
                if user in self.websocket_server.connected_users:
                    name = self.websocket_server.connected_users[user]
                    del self.websocket_server.connected_users[user]
                    self.log.debug("Y user left: %s", name)
            # filter out message depending on changes
            if skip:
                self.log.debug(
                    "Filtered out Y message of type: %s",
                    YMessageType(message_type).name,
                )
                return skip

        self._message_queue.put_nowait(message)
        self.websocket_server.ypatch_nb += 1

    def on_close(self) -> None:
        # stop serving this client
        self._message_queue.put_nowait(b"")
        if isinstance(self.room, DocumentRoom) and self.room.clients == [self]:
            # no client in this room after we disconnect
            # keep the document for a while in case someone reconnects
            self.log.info("Cleaning room: %s", self._room_id)
            self.room.cleaner = asyncio.create_task(self.clean_room())

    async def clean_room(self) -> None:
        assert isinstance(self.room, DocumentRoom)

        if self._cleanup_delay is None:
            return

        await asyncio.sleep(self._cleanup_delay)

        # Remove the room from the websocket server
        assert self.websocket_server is not None
        self.log.info("Deleting Y document from memory: %s", self.room.room_id)
        self.websocket_server.delete_room(room=self.room)

        # Clean room
        del self.room
        self.log.info("Room %s deleted", self._room_id)

        # Clean the file loader if there are not rooms using it
        file = self.files[self._path]
        if file.number_of_subscriptions() == 0:
            self.log.info("Deleting file %s", file.path)
            del self.files[self._path]

    def check_origin(self, origin):
        return True


class DocSessionHandler(APIHandler):
    auth_resource = "contents"

    @web.authenticated
    @authorized
    async def put(self, path):
        body = json.loads(self.request.body)
        format = body["format"]
        content_type = body["type"]
        file_id_manager = self.settings["file_id_manager"]

        idx = file_id_manager.get_id(path)
        if idx is not None:
            # index already exists
            self.log.info("Request for Y document '%s' with room ID: %s", path, idx)
            data = json.dumps(
                {"format": format, "type": content_type, "fileId": idx, "sessionId": SERVER_SESSION}
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
            {"format": format, "type": content_type, "fileId": idx, "sessionId": SERVER_SESSION}
        )
        self.set_status(201)
        return self.finish(data)

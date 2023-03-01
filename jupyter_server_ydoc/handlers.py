# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import asyncio
import json
import uuid
from logging import Logger
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from jupyter_server.auth import authorized
from jupyter_server.base.handlers import APIHandler, JupyterHandler
from jupyter_server.utils import ensure_async
from jupyter_ydoc import ydocs as YDOCS  # type: ignore
from tornado import web
from tornado.websocket import WebSocketHandler
from traitlets import Int, Unicode
from traitlets.config import LoggingConfigurable
from ypy_websocket.websocket_server import WebsocketServer, YRoom  # type: ignore
from ypy_websocket.ystore import BaseYStore  # type: ignore
from ypy_websocket.ystore import SQLiteYStore as _SQLiteYStore
from ypy_websocket.ystore import TempFileYStore as _TempFileYStore
from ypy_websocket.ystore import YDocNotFound
from ypy_websocket.yutils import YMessageType  # type: ignore

YFILE = YDOCS["file"]

SERVER_SESSION = str(uuid.uuid4())


class TempFileYStore(_TempFileYStore):
    prefix_dir = "jupyter_ystore_"


class SQLiteYStoreMetaclass(type(LoggingConfigurable), type(_SQLiteYStore)):  # type: ignore
    pass


class SQLiteYStore(LoggingConfigurable, _SQLiteYStore, metaclass=SQLiteYStoreMetaclass):
    db_path = Unicode(
        ".jupyter_ystore.db",
        config=True,
        help="""The path to the YStore database. Defaults to '.jupyter_ystore.db' in the current
        directory.""",
    )

    document_ttl = Int(
        None,
        allow_none=True,
        config=True,
        help="""The document time-to-live in seconds. Defaults to None (document history is never
        cleared).""",
    )


class DocumentRoom(YRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    def __init__(self, type: str, ystore: BaseYStore, log: Optional[Logger]):
        super().__init__(ready=False, ystore=ystore, log=log)
        self.type = type
        self.cleaner: Optional["asyncio.Task[Any]"] = None
        self.watcher: Optional["asyncio.Task[Any]"] = None
        self.document = YDOCS.get(type, YFILE)(self.ydoc)


class TransientRoom(YRoom):
    """A Y room for sharing state (e.g. awareness)."""

    def __init__(self, log: Optional[Logger]):
        super().__init__(log=log)


class JupyterWebsocketServer(WebsocketServer):

    rooms: Dict[str, YRoom]
    ypatch_nb: int
    connected_user: Dict[int, str]

    def __init__(self, *args, **kwargs):
        self.ystore_class = kwargs.pop("ystore_class")
        self.log = kwargs["log"]
        super().__init__(*args, **kwargs)
        self.ypatch_nb = 0
        self.connected_users = {}
        asyncio.create_task(self.monitor())

    async def monitor(self):
        while True:
            await asyncio.sleep(60)
            clients_nb = sum(len(room.clients) for room in self.rooms.values())
            self.log.info("Processed %s Y patches in one minute", self.ypatch_nb)
            self.log.info("Connected Y users: %s", clients_nb)
            self.ypatch_nb = 0

    def get_room(self, path: str) -> YRoom:
        if path not in self.rooms:
            if path.count(":") >= 2:
                # it is a stored document (e.g. a notebook)
                file_format, file_type, file_path = path.split(":", 2)
                p = Path(file_path)
                updates_file_path = str(p.parent / f".{file_type}:{p.name}.y")
                ystore = self.ystore_class(path=updates_file_path, log=self.log)
                self.rooms[path] = DocumentRoom(file_type, ystore, self.log)
            else:
                # it is a transient document (e.g. awareness)
                self.rooms[path] = TransientRoom(self.log)
        return self.rooms[path]


class YDocWebSocketHandler(WebSocketHandler, JupyterHandler):
    """`YDocWebSocketHandler` uses the singleton pattern for `WebsocketServer`,
    which is a subclass of ypy-websocket's `WebsocketServer`.

    In `WebsocketServer`, we expect to use a WebSocket object as follows:
    - receive messages until the connection is closed with
      `for message in websocket: pass`.
    - send a message with `await websocket.send(message)`.

    Tornado's WebSocket API is different, so `YDocWebSocketHandler` needs to be adapted:
    - `YDocWebSocketHandler` is an async iterator, that will yield received messages.
      Messages received in Tornado's `on_message(message)` are put in an async
      `_message_queue`, from which we get them asynchronously.
    - The `send(message)` method is async and calls Tornado's `write_message(message)`.
    - Although it's currently not used in ypy-websocket, `recv()` is an async method for
      receiving a message.
    """

    saving_document: Optional["asyncio.Task[Any]"]
    websocket_server: Optional[JupyterWebsocketServer] = None
    _message_queue: "asyncio.Queue[Any]"

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

    def get_file_info(self) -> Tuple[str, str, str]:
        assert self.websocket_server is not None
        assert isinstance(self.room, DocumentRoom)
        room_name = self.websocket_server.get_room_name(self.room)
        file_format: str
        file_type: str
        file_path: Optional[str]
        file_id: str
        file_format, file_type, file_id = room_name.split(":", 2)
        file_path = self.settings["file_id_manager"].get_path(file_id)
        if file_path is None:
            raise RuntimeError(f"File {self.room.document.path} cannot be found anymore")
        assert file_path is not None
        if file_path != self.room.document.path:
            self.log.debug(
                "File with ID %s was moved from %s to %s",
                self.room.document.path,
                file_path,
            )
            self.room.document.path = file_path
        return file_format, file_type, file_path

    def set_file_info(self, value: str) -> None:
        assert self.websocket_server is not None
        self.websocket_server.rename_room(value, from_room=self.room)
        self.path = value  # needed to be compatible with WebsocketServer (websocket.path)

    async def get(self, *args, **kwargs):
        if self.get_current_user() is None:
            self.log.warning("Couldn't authenticate WebSocket connection")
            raise web.HTTPError(403)
        return await super().get(*args, **kwargs)

    async def open(self, path):
        ystore_class = self.settings["collaborative_ystore_class"]
        if self.websocket_server is None:
            for k, v in self.config.get(ystore_class.__name__, {}).items():
                setattr(ystore_class, k, v)
            YDocWebSocketHandler.websocket_server = JupyterWebsocketServer(
                rooms_ready=False,
                auto_clean_rooms=False,
                ystore_class=ystore_class,
                log=self.log,
            )
        self._message_queue = asyncio.Queue()
        self.lock = asyncio.Lock()
        assert self.websocket_server is not None
        self.room = self.websocket_server.get_room(path)
        self.set_file_info(path)
        self.saving_document = None
        asyncio.create_task(self.websocket_server.serve(self))

        # Close the connection if the document session expired
        session_id = self.get_query_argument("sessionId", "")
        if isinstance(self.room, DocumentRoom) and SERVER_SESSION != session_id:
            self.close(1003, f"Document session {session_id} expired")

        # cancel the deletion of the room if it was scheduled
        if isinstance(self.room, DocumentRoom) and self.room.cleaner is not None:
            self.room.cleaner.cancel()

        if isinstance(self.room, DocumentRoom) and not self.room.ready:
            file_format, file_type, file_path = self.get_file_info()
            self.log.debug("Opening Y document from disk: %s", file_path)
            model = await ensure_async(
                self.contents_manager.get(file_path, type=file_type, format=file_format)
            )
            self.last_modified = model["last_modified"]
            # check again if ready, because loading the file can be async
            if not self.room.ready:
                # try to apply Y updates from the YStore for this document
                read_from_source = True
                if self.room.ystore is not None:
                    try:
                        await self.room.ystore.apply_updates(self.room.ydoc)
                        read_from_source = False
                    except YDocNotFound:
                        # YDoc not found in the YStore, create the document from the source file (no change history)
                        pass
                if not read_from_source:
                    # if YStore updates and source file are out-of-sync, resync updates with source
                    if self.room.document.source != model["content"]:
                        read_from_source = True

                if read_from_source:
                    self.room.document.source = model["content"]
                    if self.room.ystore:
                        await self.room.ystore.encode_state_as_update(self.room.ydoc)
                self.room.document.dirty = False
                self.room.ready = True
                self.room.watcher = asyncio.create_task(self.watch_file())
                # save the document when changed
                self.room.document.observe(self.on_document_change)

    async def watch_file(self):
        assert isinstance(self.room, DocumentRoom)
        poll_interval = self.settings["collaborative_file_poll_interval"]
        if not poll_interval:
            self.room.watcher = None
            return
        while True:
            await asyncio.sleep(poll_interval)
            await self.maybe_load_document()

    async def maybe_load_document(self):
        assert isinstance(self.room, DocumentRoom)
        file_format, file_type, file_path = self.get_file_info()
        async with self.lock:
            model = await ensure_async(
                self.contents_manager.get(
                    file_path, content=False, type=file_type, format=file_format
                )
            )
        # do nothing if the file was saved by us
        if self.last_modified < model["last_modified"]:
            self.log.debug("Reverting file that had out-of-band changes: %s", file_path)
            model = await ensure_async(
                self.contents_manager.get(file_path, type=file_type, format=file_format)
            )
            self.room.document.source = model["content"]
            self.last_modified = model["last_modified"]

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
            self.room.cleaner = asyncio.create_task(self.clean_room())

    async def clean_room(self) -> None:
        assert isinstance(self.room, DocumentRoom)
        seconds = self.settings["collaborative_document_cleanup_delay"]
        if seconds is None:
            return
        await asyncio.sleep(seconds)
        if self.room.watcher is not None:
            self.room.watcher.cancel()
        self.room.document.unobserve()
        assert self.websocket_server is not None
        file_format, file_type, file_path = self.get_file_info()
        self.log.debug("Deleting Y document from memory: %s", file_path)
        self.websocket_server.delete_room(room=self.room)

    def on_document_change(self, event):
        try:
            dirty = event.keys["dirty"]["newValue"]
            if not dirty:
                # we cleared the dirty flag, nothing to save
                return
        except Exception:
            pass
        if self.saving_document is not None and not self.saving_document.done():
            # the document is being saved, cancel that
            self.saving_document.cancel()
            self.saving_document = None
        self.saving_document = asyncio.create_task(self.maybe_save_document())

    async def maybe_save_document(self):
        assert isinstance(self.room, DocumentRoom)
        seconds = self.settings["collaborative_document_save_delay"]
        if seconds is None:
            return
        # save after X seconds of inactivity
        await asyncio.sleep(seconds)
        # if the room cannot be found, don't save
        try:
            file_format, file_type, file_path = self.get_file_info()
        except Exception:
            return
        self.log.debug("Opening Y document from disk: %s", file_path)
        async with self.lock:
            model = await ensure_async(
                self.contents_manager.get(file_path, type=file_type, format=file_format)
            )
        if self.last_modified < model["last_modified"]:
            # file changed on disk, let's revert
            self.log.debug("Reverting file that had out-of-band changes: %s", file_path)
            self.room.document.source = model["content"]
            self.last_modified = model["last_modified"]
            return
        if model["content"] != self.room.document.source:
            # don't save if not needed
            # this also prevents the dirty flag from bouncing between windows of
            # the same document opened as different types (e.g. notebook/text editor)
            model["format"] = file_format
            model["content"] = self.room.document.source
            self.log.debug("Saving Y document to disk: %s", file_path)
            async with self.lock:
                model = await ensure_async(self.contents_manager.save(model, file_path))
                self.last_modified = model["last_modified"]
        self.room.document.dirty = False

    def check_origin(self, origin):
        return True


class YDocRoomIdHandler(APIHandler):
    auth_resource = "contents"

    @web.authenticated
    @authorized
    async def put(self, path):
        body = json.loads(self.request.body)
        ws_url = f"{body['format']}:{body['type']}:"

        file_id_manager = self.settings["file_id_manager"]

        idx = file_id_manager.get_id(path)
        if idx is not None:
            # index already exists
            self.set_status(200)
            ws_url += str(idx)
            self.log.info("Request for Y document '%s' with room ID: %s", path, ws_url)
            return self.finish(ws_url)

        # try indexing
        idx = file_id_manager.index(path)
        if idx is None:
            # file does not exists
            raise web.HTTPError(404, f"File {path!r} does not exist")

        # index successfully created
        self.set_status(201)
        ws_url += str(idx)
        self.log.info("Request for Y document '%s' with room ID: %s", path, ws_url)
        return self.finish(ws_url)


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

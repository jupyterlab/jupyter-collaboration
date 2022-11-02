# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import asyncio
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from jupyter_server.auth import authorized
from jupyter_server.base.handlers import APIHandler, JupyterHandler
from jupyter_server.utils import ensure_async
from jupyter_ydoc import ydocs as YDOCS  # type: ignore
from tornado import web
from tornado.websocket import WebSocketHandler
from ypy_websocket.websocket_server import WebsocketServer, YRoom  # type: ignore
from ypy_websocket.ystore import (  # type: ignore
    BaseYStore,
    SQLiteYStore,
    TempFileYStore,
    YDocNotFound,
)

YFILE = YDOCS["file"]
AWARENESS = 1


class JupyterTempFileYStore(TempFileYStore):
    prefix_dir = "jupyter_ystore_"


class JupyterSQLiteYStore(SQLiteYStore):
    db_path = ".jupyter_ystore.db"


class DocumentRoom(YRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    is_transient = False

    def __init__(self, type: str, ystore: BaseYStore):
        super().__init__(ready=False, ystore=ystore)
        self.type = type
        self.cleaner: Optional["asyncio.Task[Any]"] = None
        self.watcher: Optional["asyncio.Task[Any]"] = None
        self.document = YDOCS.get(type, YFILE)(self.ydoc)


class TransientRoom(YRoom):
    """A Y room for sharing state (e.g. awareness)."""

    is_transient = True


async def metadata_callback() -> bytes:
    # the current datetime will be stored in metadata as bytes
    # it can be retrieved as:
    # datetime.fromisoformat(metadata.decode())
    return datetime.utcnow().isoformat().encode()


class JupyterWebsocketServer(WebsocketServer):

    rooms: Dict[str, YRoom]

    def __init__(self, *args, **kwargs):
        self.ystore_class = kwargs.pop("ystore_class")
        super().__init__(*args, **kwargs)

    def get_room(self, path: str) -> YRoom:
        if path not in self.rooms.keys():
            if path.count(":") >= 2:
                # it is a stored document (e.g. a notebook)
                file_format, file_type, file_path = path.split(":", 2)
                p = Path(file_path)
                updates_file_path = str(p.parent / f".{file_type}:{p.name}.y")
                ystore = self.ystore_class(
                    path=updates_file_path, metadata_callback=metadata_callback
                )
                self.rooms[path] = DocumentRoom(file_type, ystore)
            else:
                # it is a transient document (e.g. awareness)
                self.rooms[path] = TransientRoom()
        return self.rooms[path]


class YDocWebSocketHandler(WebSocketHandler, JupyterHandler):

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
        room_name = self.websocket_server.get_room_name(self.room)
        file_format: str
        file_type: str
        file_path: Optional[str]
        file_id: str
        file_format, file_type, file_id = room_name.split(":", 2)
        file_id_manager = self.settings.get("file_id_manager")
        if file_id_manager is None:
            # no file ID manager installed, the path is the ID
            file_path = file_id
        else:
            file_path = file_id_manager.get_path(file_id)
        if file_path is None:
            raise RuntimeError(f"File {self.room.document.path} cannot be found anymore")
        assert file_path is not None
        if file_path != self.room.document.path:
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
            YDocWebSocketHandler.websocket_server = JupyterWebsocketServer(
                rooms_ready=False, auto_clean_rooms=False, ystore_class=ystore_class
            )
        self._message_queue = asyncio.Queue()
        assert self.websocket_server is not None
        self.room = self.websocket_server.get_room(path)
        self.set_file_info(path)
        self.saving_document = None
        asyncio.create_task(self.websocket_server.serve(self))

        # cancel the deletion of the room if it was scheduled
        if not self.room.is_transient and self.room.cleaner is not None:
            self.room.cleaner.cancel()

        if not self.room.is_transient and not self.room.ready:
            file_format, file_type, file_path = self.get_file_info()
            model = await ensure_async(
                self.contents_manager.get(file_path, type=file_type, format=file_format)
            )
            self.last_modified = model["last_modified"]
            # check again if ready, because loading the file can be async
            if not self.room.ready:
                # try to apply Y updates from the YStore for this document
                try:
                    await self.room.ystore.apply_updates(self.room.ydoc)
                    read_from_source = False
                except YDocNotFound:
                    # YDoc not found in the YStore, create the document from the source file (no change history)
                    read_from_source = True
                if not read_from_source:
                    # if YStore updates and source file are out-of-sync, resync updates with source
                    if self.room.document.source != model["content"]:
                        read_from_source = True
                if read_from_source:
                    self.room.document.source = model["content"]
                    await self.room.ystore.encode_state_as_update(self.room.ydoc)
                self.room.document.dirty = False
                self.room.ready = True
                self.room.watcher = asyncio.create_task(self.watch_file())
                # save the document when changed
                self.room.document.observe(self.on_document_change)

    async def watch_file(self):
        poll_interval = self.settings["collaborative_file_poll_interval"]
        if not poll_interval:
            self.room.watcher = None
            return
        while True:
            await asyncio.sleep(poll_interval)
            await self.maybe_load_document()

    async def maybe_load_document(self):
        file_format, file_type, file_path = self.get_file_info()
        model = await ensure_async(
            self.contents_manager.get(file_path, content=False, type=file_type, format=file_format)
        )
        # do nothing if the file was saved by us
        if self.last_modified < model["last_modified"]:
            model = await ensure_async(
                self.contents_manager.get(file_path, type=file_type, format=file_format)
            )
            self.room.document.source = model["content"]
            self.last_modified = model["last_modified"]

    async def send(self, message):
        # needed to be compatible with WebsocketServer (websocket.send)
        self.write_message(message, binary=True)

    async def recv(self):
        message = await self._message_queue.get()
        return message

    def on_message(self, message):
        if message[0] == AWARENESS:
            # awareness
            skip = False
            # changes = self.room.awareness.get_changes(msg)
            # filter out message depending on changes
            if skip:
                return skip
        self._message_queue.put_nowait(message)

    def on_close(self) -> None:
        # stop serving this client
        self._message_queue.put_nowait(b"")
        if not self.room.is_transient and self.room.clients == [self]:
            # no client in this room after we disconnect
            # keep the document for a while in case someone reconnects
            self.room.cleaner = asyncio.create_task(self.clean_room())

    async def clean_room(self) -> None:
        seconds = self.settings["collaborative_document_cleanup_delay"]
        if seconds is None:
            return
        await asyncio.sleep(seconds)
        if self.room.watcher is not None:
            self.room.watcher.cancel()
        self.room.document.unobserve()
        assert self.websocket_server is not None
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
        model = await ensure_async(
            self.contents_manager.get(file_path, type=file_type, format=file_format)
        )
        if self.last_modified < model["last_modified"]:
            # file changed on disk, let's revert
            self.room.document.source = model["content"]
            self.last_modified = model["last_modified"]
            return
        if model["content"] != self.room.document.source:
            # don't save if not needed
            # this also prevents the dirty flag from bouncing between windows of
            # the same document opened as different types (e.g. notebook/text editor)
            model["format"] = file_format
            model["content"] = self.room.document.source
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

        file_id_manager = self.settings.get("file_id_manager")
        if file_id_manager is None:
            # no file ID manager installed, the ID is the path
            ws_url += path
            return self.finish(ws_url)

        idx = file_id_manager.get_id(path)
        if idx is not None:
            # index already exists
            self.set_status(200)
            ws_url += str(idx)
            return self.finish(ws_url)

        # try indexing
        idx = file_id_manager.index(path)
        if idx is None:
            # file does not exists
            raise web.HTTPError(404, f"File {path!r} does not exist")

        # index successfully created
        self.set_status(201)
        ws_url += str(idx)
        return self.finish(ws_url)

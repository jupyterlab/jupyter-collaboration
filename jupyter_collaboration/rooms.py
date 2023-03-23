import asyncio
from logging import Logger
from typing import Optional

from ypy_websocket.websocket_server import YRoom
from ypy_websocket.ystore import BaseYStore, YDocNotFound

from jupyter_ydoc import ydocs as YDOCS

from .loaders import FileLoader
from .utils import decode_file_path

YFILE = YDOCS["file"]

class DocumentRoom(YRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    def __init__(self, room_id: str, file: FileLoader, ystore: Optional[BaseYStore], log: Optional[Logger]):
        super().__init__(ready=False, ystore=ystore, log=log)
        
        self._room_id: str = room_id
        self._file: FileLoader = file
        self._document = YDOCS.get(type, YFILE)(self.ydoc)

        # Add room to the file for loading content
        self._file.add_room(self.room_id, self)

        self._cleaner: asyncio.Task = None

        # save the document when changed
        self._document.observe(self._on_document_change)

    @property
    def room_id(self) -> str:
        return self._room_id
    
    @property
    def cleaner(self) -> asyncio.Task:
        return self._cleaner
    
    @cleaner.setter
    def cleaner(self, value: asyncio.Task) -> None:
        self._cleaner = value
    
    def __del__(self) -> None:
        self._document.unobserve()
        self._file.remove_room(self.room_id)
    
    async def initialize(self):
        format, file_type, _ = decode_file_path(self._room_id)
        model = await self._file.load_file_data(format, file_type, True)
        print(model)

        # try to apply Y updates from the YStore for this document
        read_from_source = True
        if self.ystore is not None:
            try:
                await self.ystore.apply_updates(self.ydoc)
                read_from_source = False
            except YDocNotFound:
                # YDoc not found in the YStore, create the document from the source file (no change history)
                pass
        
        if not read_from_source:
            # if YStore updates and source file are out-of-sync, resync updates with source
            if self._document.source != model["content"]:
                read_from_source = True

        if read_from_source:
            self._document.source = model["content"]
            if self.ystore:
                await self.ystore.encode_state_as_update(self.ydoc)
        
        await self.set_document_content()
        self._ready = True

    def clear_dirty_flag(self) -> None:
        self._document.dirty = False

    async def set_document_content(self) -> None:
        format, file_type, _ = decode_file_path(self._room_id)
        model = await self._file.load_file_data(format, file_type, True)
        self._document.source = model["content"]
        self.clear_dirty_flag()
    
    def _on_document_change(self, target, event):
        if target == "state" and "dirty" in event.keys:
            dirty = event.keys["dirty"]["newValue"]
            if not dirty:
                # we cleared the dirty flag, nothing to save
                return
        
        format, file_type, _ = decode_file_path(self._room_id)
        self._file.save_content({
            "format": format,
            "type": file_type,
            "content": self._document.source
        })


class TransientRoom(YRoom):
    """A Y room for sharing state (e.g. awareness)."""

    def __init__(self, log: Optional[Logger]):
        super().__init__(log=log)

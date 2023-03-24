import asyncio
from logging import Logger
from typing import Optional

from ypy_websocket.websocket_server import YRoom
from ypy_websocket.ystore import BaseYStore, YDocNotFound

from jupyter_ydoc import ydocs as YDOCS

from .loaders import FileLoader

YFILE = YDOCS["file"]

class DocumentRoom(YRoom):
    """A Y room for a possibly stored document (e.g. a notebook)."""

    def __init__(self, room_id: str, file_format: str, file_type: str, file: FileLoader, ystore: Optional[BaseYStore], log: Optional[Logger], save_delay: int = None):
        super().__init__(ready=False, ystore=ystore, log=log)
        
        self._room_id: str = room_id
        self._file_format: str = file_format
        self._file_type: str = file_type
        self._file: FileLoader = file
        self._document = YDOCS.get(self._file_type, YFILE)(self.ydoc)

        self._save_delay = save_delay

        self._cleaner: asyncio.Task = None
        self._saving_document: asyncio.Task = None

        # Listen for document changes
        self._document.observe(self._on_document_change)
        self._file.observe(self.room_id, self._on_content_change)

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
        # TODO: Should we cancel or wait ?
        self._saving_document.cancel()
        self._document.unobserve()
        self._file.unobserve(self.room_id)
    
    async def initialize(self):
        model = await self._file.load_content(self._file_format, self._file_type, True)

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
        
        self._document.dirty = False
        self.ready = True
    
    async def _set_document_content(self) -> None:
        model = await self._file.load_content(self._file_format, self._file_type, True)
        self._document.source = model["content"]
        self._document.dirty = False
    
    def _on_content_change(self, event):
        if event == "changed":
            self._set_document_content()

    def _on_document_change(self, target, event):
        if target == "state" and "dirty" in event.keys:
            dirty = event.keys["dirty"]["newValue"]
            if not dirty:
                # we cleared the dirty flag, nothing to save
                return
        
        if self._saving_document is not None and not self._saving_document.done():
            # the document is being saved, cancel that
            self._saving_document.cancel()
            self._saving_document = None

        self._saving_document = asyncio.create_task(self._maybe_save_document())
    
    async def _maybe_save_document(self):
        if self._save_delay is None:
            return
        
        # save after X seconds of inactivity
        await asyncio.sleep(self._save_delay)

        await self._file.save_content({
            "format": self._file_format,
            "type": self._file_type,
            "content": self._document.source
        })
        self._document.dirty = False


class TransientRoom(YRoom):
    """A Y room for sharing state (e.g. awareness)."""

    def __init__(self, room_id: str, log: Optional[Logger]):
        super().__init__(log=log)

        self._room_id = room_id

    @property
    def room_id(self) -> str:
        return self._room_id

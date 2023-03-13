from logging import Logger
from typing import Optional

from ypy_websocket.websocket_server import YRoom
from ypy_websocket.ystore import BaseYStore

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
        self._file.add_room(self._room_id, self)

        # save the document when changed
        self._document.observe(self._on_document_change)

    async def initialize(self):
        await self.set_document_content()
        self._ready = True
    
    def clean_room(self) -> None:
        self._document.unobserve()
        self._file.remove_room(self._room_id)

    def clear_dirty_flag(self) -> None:
        self.room.document.dirty = False

    async def set_document_content(self) -> None:
        format, file_type, _ = decode_file_path(self._room_id)
        model = await self._file.load_file_data(format, file_type, True)
        self.room.document.source = model["content"]
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

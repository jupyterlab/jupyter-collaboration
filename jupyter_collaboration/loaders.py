import asyncio
from typing import Any, Dict

from jupyter_server.utils import ensure_async

from .rooms import DocumentRoom
from .utils import decode_file_path


class FileLoader():

    def __init__(self, path: str, contents_manager: Any, save_delay: str = None, poll_interval: str = None) -> None:
        
        self._path = path
        self._last_modified = None
        self._lock = asyncio.Lock()
        self._rooms: Dict[str, DocumentRoom] = {}

        self._save_delay = save_delay
        self._poll_interval = poll_interval
        self._contents_manager = contents_manager
        
        self._saving_document = None
        self._watcher = asyncio.create_task(self.watch_file())
    
    def rename_file(self, path: str):
        self._path = path

    def number_of_rooms(self) -> int:
        return len(self._rooms)
    
    def add_room(self, room_id: str, room: DocumentRoom) -> None:
        self._rooms[room_id] = room
    
    def remove_room(self, room_id: str) -> None:
        del self._rooms[room_id]
    
    async def load_file_data(self, format: str, file_type: str, content: bool) -> Dict[str, Any]:
        return await ensure_async(
            self.contents_manager.get(self._path, format=format, type=file_type, content=content)
        )
    
    async def save_content(self, model: Dict[str, Any]):
        if self._saving_document is not None and not self._saving_document.done():
            # the document is being saved, cancel that
            self._saving_document.cancel()
            self._saving_document = None

        self._saving_document = asyncio.create_task(
            self._maybe_save_document(model)
        )
        
    async def watch_file(self):
        if not self._poll_interval:
            self._watcher = None
            return
        
        while True:
            await asyncio.sleep(self._poll_interval)
            await self._maybe_load_document()

    async def _maybe_load_document(self):
        # Check whether there is rooms, and get the metadata from
        # the first room.
        # Doesn't mather which 'type' and 'format' we use since we
        # are not loading the content
        if not len(self._rooms):
            return

        # Get format and type from room_id
        format, file_type, _ = decode_file_path(self._rooms.keys()[0])

        async with self._lock:
            model = self.load_file_data(format, file_type, False)
        
        # do nothing if the file was saved by us
        if self._last_modified < model["last_modified"]:
            self.log.debug("Reverting file that had out-of-band changes: %s", self._path)
            self._last_modified = model["last_modified"]
            # Load the content for each room accessing this file
            for room_id, room in self._rooms.items():
                room.set_document_content()
                
    
    async def _maybe_save_document(self, model: Dict[str, Any]):
        if self._save_delay is None:
            return
        
        # save after X seconds of inactivity
        await asyncio.sleep(self._save_delay)
        
        self.log.debug("Opening Y document from disk: %s", self._path)
        async with self._lock:
            model = await self.load_file_data(model["format"], model["type"], False)
        
        if self._last_modified < model["last_modified"]:
            # file changed on disk, let's revert
            self.log.debug("Reverting file that had out-of-band changes: %s", self._path)
            self._last_modified = model["last_modified"]
            # Load the content for each room accessing this file
            for room_id, room in self._rooms.items():
                room.set_document_content()
            
            return

        async with self._lock:
            model = await ensure_async(self.contents_manager.save(model, self._path))
            self._last_modified = model["last_modified"]
            # Set dirty to false for each room accessing this file
            for room_id, room in self._rooms.items():
                room.clear_dirty_flag()
            

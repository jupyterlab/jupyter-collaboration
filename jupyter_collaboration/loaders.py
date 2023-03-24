import asyncio
from typing import Any, Dict, Callable

from jupyter_server.utils import ensure_async


class FileLoader():

    def __init__(self, path: str, file_format: str, file_type: str, contents_manager: Any, poll_interval: int = None) -> None:
        self._path: str = path
        self._file_format: str = file_format
        self._file_type: str = file_type
        self._last_modified = None
        
        self._lock = asyncio.Lock()
        self._poll_interval = poll_interval
        self._contents_manager = contents_manager

        self._subscriptions: Dict[str, Callable] = {}
        self._watcher = asyncio.create_task(self.watch_file())
    
    def __del__(self) -> None:
        self._watcher.cancel()

    def rename_file(self, path: str):
        self._path = path

    def number_of_subscriptions(self) -> int:
        return len(self._subscriptions)
    
    def observe(self, id: str, callback: Callable) -> None:
        self._subscriptions[id] = callback
    
    def unobserve(self, id: str) -> None:
        del self._subscriptions[id]
    
    async def load_content(self, format: str, file_type: str, content: bool) -> Dict[str, Any]:
        return await ensure_async(
            self._contents_manager.get(self._path, format=format, type=file_type, content=content)
        )
    
    async def save_content(self, model: Dict[str, Any]):
        #self.log.debug("Opening Y document from disk: %s", self._path)
        async with self._lock:
            m = await self.load_content(model["format"], model["type"], False)
        
            if self._last_modified is None or self._last_modified >= m["last_modified"]:
                model = await ensure_async(self._contents_manager.save(model, self._path))
                self._last_modified = model["last_modified"]
                
            else :
                # file changed on disk, let's revert
                #self.log.debug("Reverting file that had out-of-band changes: %s", self._path)
                self._last_modified = model["last_modified"]
                # Notify that the content changed on disk
                for _, callback in self._subscriptions.items():
                    callback('changed')
            
        
    async def watch_file(self):
        if not self._poll_interval:
            self._watcher = None
            return
        
        while True:
            await asyncio.sleep(self._poll_interval)
            await self._maybe_load_document()

    async def _maybe_load_document(self):
        if not self._lock.locked():
            model = self.load_content(self._file_format, self._file_type, False)
            
            # do nothing if the file was saved by us
            if self._last_modified < model["last_modified"]:
                #self.log.debug("Reverting file that had out-of-band changes: %s", self._path)
                self._last_modified = model["last_modified"]
                # Notify that the content changed on disk
                for _, callback in self._subscriptions.items():
                    callback('changed')

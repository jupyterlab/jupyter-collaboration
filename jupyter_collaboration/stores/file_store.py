# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import struct
import tempfile
import time
from logging import Logger, getLogger
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable

import anyio
from anyio import Event, Lock
from deprecated import deprecated
from ypy_websocket.yutils import Decoder, get_new_path, write_var_uint

from .base_store import BaseYStore
from .utils import YDocExists, YDocNotFound


class FileYStore(BaseYStore):
    """A YStore which uses one file per document."""

    _lock: Lock
    metadata_callback: Callable[[], Awaitable[bytes] | bytes] | None

    def __init__(
        self,
        path: str = "./ystore",
        metadata_callback: Callable[[], Awaitable[bytes] | bytes] | None = None,
        log: Logger | None = None,
    ) -> None:
        """Initialize the object.

        Arguments:
            path: The file path used to store the updates.
            metadata_callback: An optional callback to call to get the metadata.
            log: An optional logger.
        """
        self._lock = Lock()
        self._store_path = path
        self.metadata_callback = metadata_callback
        self.log = log or getLogger(__name__)

    async def initialize(self) -> None:
        """
        Initializes the store.
        """
        if self.initialized or self._initialized is not None:
            return
        self._initialized = Event()

        version_path = Path(self._store_path, "__version__")
        if not await anyio.Path(self._store_path).exists():
            await anyio.Path(self._store_path).mkdir(parents=True, exist_ok=True)

        version = -1
        create_version = False
        if await anyio.Path(version_path).exists():
            async with await anyio.open_file(version_path, "rb") as f:
                version = int(await f.readline())

                # Store version mismatch. Move store and create a new one.
                if self.version != version:
                    create_version = True

            if create_version:
                new_path = await get_new_path(self._store_path)
                self.log.warning(
                    f"YStore version mismatch, moving {self._store_path} to {new_path}"
                )
                await anyio.Path(self._store_path).rename(new_path)
                await anyio.Path(self._store_path).mkdir(parents=True, exist_ok=True)

        else:
            create_version = True

        if create_version:
            async with await anyio.open_file(version_path, "wb") as f:
                version_bytes = str(self.version).encode()
                await f.write(version_bytes)

        self._initialized.set()

    async def exists(self, path: str) -> bool:
        """
        Returns True if the document exists, else returns False.

        Arguments:
            path: The document name/path.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        return await anyio.Path(self._get_document_path(path)).exists()

    async def list(self) -> AsyncIterator[str]:  # type: ignore[override]
        """
        Returns a list with the name/path of the documents stored.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        async for child in anyio.Path(self._store_path).glob("**/*.y"):
            yield child.relative_to(self._store_path).with_suffix("").as_posix()

    async def get(self, path: str, updates: bool = False) -> dict | None:
        """
        Returns the document's metadata and updates or None if the document does't exist.

        Arguments:
            path: The document name/path.
            updates: Whether to return document's content or only the metadata.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        file_path = self._get_document_path(path)
        if not await anyio.Path(file_path).exists():
            return None
        else:
            version = None
            async with await anyio.open_file(file_path, "rb") as f:
                header = await f.read(8)
                if header == b"VERSION:":
                    version = int(await f.readline())

                list_updates: list[tuple[bytes, bytes, float]] = []
                if updates:
                    data = await f.read()
                    async for update, metadata, timestamp in self._decode_data(data):
                        list_updates.append((update, metadata, timestamp))

                return dict(path=path, version=version, updates=list_updates)

    async def create(self, path: str, version: int) -> None:
        """
        Creates a new document.

        Arguments:
            path: The document name/path.
            version: Document version.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        file_path = self._get_document_path(path)
        if await anyio.Path(file_path).exists():
            raise YDocExists(f"The document {path} already exists.")

        else:
            await anyio.Path(file_path.parent).mkdir(parents=True, exist_ok=True)
            async with await anyio.open_file(file_path, "wb") as f:
                version_bytes = f"VERSION:{version}\n".encode()
                await f.write(version_bytes)

    async def remove(self, path: str) -> None:
        """
        Removes a document.

        Arguments:
            path: The document name/path.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        file_path = self._get_document_path(path)
        if await anyio.Path(file_path).exists():
            await anyio.Path(file_path).unlink(missing_ok=False)
        else:
            raise YDocNotFound(f"The document {path} doesn't exists.")

    async def read(self, path: str) -> AsyncIterator[tuple[bytes, bytes, float]]:  # type: ignore
        """Async iterator for reading the store content.

        Returns:
            A tuple of (update, metadata, timestamp) for each update.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        async with self._lock:
            file_path = self._get_document_path(path)
            if not await anyio.Path(file_path).exists():
                raise YDocNotFound

            offset = await self._get_data_offset(file_path)
            async with await anyio.open_file(file_path, "rb") as f:
                await f.seek(offset)
                data = await f.read()
                if not data:
                    raise YDocNotFound

        async for res in self._decode_data(data):
            yield res

    async def write(self, path: str, data: bytes) -> None:
        """Store an update.

        Arguments:
            data: The update to store.
        """
        async with self._lock:
            file_path = self._get_document_path(path)
            if not await anyio.Path(file_path).exists():
                raise YDocNotFound

            async with await anyio.open_file(file_path, "ab") as f:
                data_len = write_var_uint(len(data))
                await f.write(data_len + data)
                metadata = await self.get_metadata()
                metadata_len = write_var_uint(len(metadata))
                await f.write(metadata_len + metadata)
                timestamp = struct.pack("<d", time.time())
                timestamp_len = write_var_uint(len(timestamp))
                await f.write(timestamp_len + timestamp)

    async def _get_data_offset(self, path: Path) -> int:
        try:
            async with await anyio.open_file(path, "rb") as f:
                header = await f.read(8)
                if header == b"VERSION:":
                    await f.readline()
                    return await f.tell()
                else:
                    raise Exception

        except Exception:
            raise YDocNotFound(f"File {str(path)} not found.")

    async def _decode_data(self, data) -> AsyncIterator[tuple[bytes, bytes, float]]:
        i = 0
        for d in Decoder(data).read_messages():
            if i == 0:
                update = d
            elif i == 1:
                metadata = d
            else:
                timestamp = struct.unpack("<d", d)[0]
                yield update, metadata, timestamp
            i = (i + 1) % 3

    def _get_document_path(self, path: str) -> Path:
        return Path(self._store_path, path + ".y")


@deprecated(reason="Use FileYStore instead")
class TempFileYStore(FileYStore):
    """
    A YStore which uses the system's temporary directory.
    Files are writen under a common directory.
    To prefix the directory name (e.g. /tmp/my_prefix_b4whmm7y/):

    ```py
    class PrefixTempFileYStore(TempFileYStore):
        prefix_dir = "my_prefix_"
    ```

    ## Note:
    This class is deprecated. Use FileYStore and pass the tmp folder
    as path argument. For example:

    ```py
    tmp_dir = tempfile.mkdtemp(prefix="prefix/directory/")
    store = FileYStore(tmp_dir)
    ```
    """

    prefix_dir: str | None = None
    base_dir: str | None = None

    def __init__(
        self,
        path: str,
        metadata_callback: Callable[[], Awaitable[bytes] | bytes] | None = None,
        log: Logger | None = None,
    ):
        """Initialize the object.

        Arguments:
            path: The file path used to store the updates.
            metadata_callback: An optional callback to call to get the metadata.
            log: An optional logger.
        """
        full_path = str(Path(self.get_base_dir()) / path)
        super().__init__(full_path, metadata_callback=metadata_callback, log=log)

    def get_base_dir(self) -> str:
        """Get the base directory where the update file is written.

        Returns:
            The base directory path.
        """
        if self.base_dir is None:
            self.make_directory()
        assert self.base_dir is not None
        return self.base_dir

    def make_directory(self):
        """Create the base directory where the update file is written."""
        type(self).base_dir = tempfile.mkdtemp(prefix=self.prefix_dir)

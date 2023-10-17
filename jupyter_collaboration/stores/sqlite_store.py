# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import time
from logging import Logger, getLogger
from typing import Any, AsyncIterator, Awaitable, Callable, Iterable

import aiosqlite
import anyio
import y_py as Y
from anyio import Event, Lock
from ypy_websocket.yutils import get_new_path

from .base_store import BaseYStore
from .utils import YDocExists, YDocNotFound


class SQLiteYStore(BaseYStore):
    """A YStore which uses an SQLite database.
    Unlike file-based YStores, the Y updates of all documents are stored in the same database.

    Subclass to point to your database file:

    ```py
    class MySQLiteYStore(SQLiteYStore):
        _store_path = "path/to/my_ystore.db"
    ```
    """

    _lock: Lock
    # Determines the "time to live" for all documents, i.e. how recent the
    # latest update of a document must be before purging document history.
    # Defaults to never purging document history (None).
    document_ttl: int | None = None

    def __init__(
        self,
        path: str = "./ystore.db",
        metadata_callback: Callable[[], Awaitable[bytes] | bytes] | None = None,
        log: Logger | None = None,
    ) -> None:
        """Initialize the object.

        Arguments:
            path: The database path used to store the updates.
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

        async with self._lock:
            if await anyio.Path(self._store_path).exists():
                version = -1
                async with aiosqlite.connect(self._store_path) as db:
                    cursor = await db.execute("pragma user_version")
                    row = await cursor.fetchone()
                    if row is not None:
                        version = row[0]

                # The DB has an old version. Move the database.
                if self.version != version:
                    new_path = await get_new_path(self._store_path)
                    self.log.warning(
                        f"YStore version mismatch, moving {self._store_path} to {new_path}"
                    )
                    await anyio.Path(self._store_path).rename(new_path)

            # Make sure every table exists.
            async with aiosqlite.connect(self._store_path) as db:
                await db.execute(
                    "CREATE TABLE IF NOT EXISTS documents (path TEXT PRIMARY KEY, session TEXT NOT NULL)"
                )
                await db.execute(
                    "CREATE TABLE IF NOT EXISTS yupdates (path TEXT NOT NULL, yupdate BLOB, metadata BLOB, timestamp REAL NOT NULL)"
                )
                await db.execute(
                    "CREATE INDEX IF NOT EXISTS idx_yupdates_path_timestamp ON yupdates (path, timestamp)"
                )
                await db.execute(f"PRAGMA user_version = {self.version}")
                await db.commit()

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

        async with self._lock:
            async with aiosqlite.connect(self._store_path) as db:
                cursor = await db.execute(
                    "SELECT path, session FROM documents WHERE path = ?",
                    (path,),
                )
                return (await cursor.fetchone()) is not None

    async def list(self) -> AsyncIterator[str]:  # type: ignore[override]
        """
        Returns a list with the name/path of the documents stored.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        async with self._lock:
            async with aiosqlite.connect(self._store_path) as db:
                async with db.execute("SELECT path FROM documents") as cursor:
                    async for path in cursor:
                        yield path[0]

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

        async with self._lock:
            async with aiosqlite.connect(self._store_path) as db:
                cursor = await db.execute(
                    "SELECT path, session FROM documents WHERE path = ?",
                    (path,),
                )
                doc = await cursor.fetchone()

                if doc is None:
                    return None

                list_updates: Iterable[Any] = []
                if updates:
                    cursor = await db.execute(
                        "SELECT yupdate, metadata, timestamp FROM yupdates WHERE path = ?",
                        (path,),
                    )
                    list_updates = await cursor.fetchall()

                return dict(path=doc[0], session_id=doc[1], updates=list_updates)

    async def create(self, path: str, session_id: str) -> None:
        """
        Creates a new document.

        Arguments:
            path: The document name/path.
            session_id: A unique identifier for the updates.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        async with self._lock:
            try:
                async with aiosqlite.connect(self._store_path) as db:
                    await db.execute(
                        "INSERT INTO documents VALUES (?, ?)",
                        (path, session_id),
                    )
                    await db.commit()
            except aiosqlite.IntegrityError:
                raise YDocExists(f"The document {path} already exists.")

    async def remove(self, path: str) -> None:
        """
        Removes a document.

        Arguments:
            path: The document name/path.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        async with self._lock:
            async with aiosqlite.connect(self._store_path) as db:
                cursor = await db.execute(
                    "SELECT path, session FROM documents WHERE path = ?",
                    (path,),
                )
                if (await cursor.fetchone()) is None:
                    raise YDocNotFound(f"The document {path} doesn't exists.")

                await db.execute(
                    "DELETE FROM documents WHERE path = ?",
                    (path,),
                )
                await db.execute(
                    "DELETE FROM yupdates WHERE path = ?",
                    (path,),
                )
                await db.commit()

    async def read(self, path: str) -> AsyncIterator[tuple[bytes, bytes, float]]:  # type: ignore
        """Async iterator for reading the store content.

        Arguments:
            path: The document name/path.

        Returns:
            A tuple of (update, metadata, timestamp) for each update.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        try:
            async with self._lock:
                async with aiosqlite.connect(self._store_path) as db:
                    async with db.execute(
                        "SELECT yupdate, metadata, timestamp FROM yupdates WHERE path = ?",
                        (path,),
                    ) as cursor:
                        found = False
                        async for update, metadata, timestamp in cursor:
                            found = True
                            yield update, metadata, timestamp
                        if not found:
                            raise YDocNotFound
        except Exception:
            raise YDocNotFound

    async def write(self, path: str, data: bytes) -> None:
        """
        Store an update.

        Arguments:
            path: The document name/path.
            data: The update to store.
        """
        if self._initialized is None:
            raise Exception("The store was not initialized.")
        await self._initialized.wait()

        async with self._lock:
            async with aiosqlite.connect(self._store_path) as db:
                # first, determine time elapsed since last update
                cursor = await db.execute(
                    "SELECT timestamp FROM yupdates WHERE path = ? ORDER BY timestamp DESC LIMIT 1",
                    (path,),
                )
                row = await cursor.fetchone()
                diff = (time.time() - row[0]) if row else 0

                if self.document_ttl is not None and diff > self.document_ttl:
                    # squash updates
                    ydoc = Y.YDoc()
                    async with db.execute(
                        "SELECT yupdate FROM yupdates WHERE path = ?", (path,)
                    ) as cursor:
                        async for update, in cursor:
                            Y.apply_update(ydoc, update)
                    # delete history
                    await db.execute("DELETE FROM yupdates WHERE path = ?", (path,))
                    # insert squashed updates
                    squashed_update = Y.encode_state_as_update(ydoc)
                    metadata = await self.get_metadata()
                    await db.execute(
                        "INSERT INTO yupdates VALUES (?, ?, ?, ?)",
                        (path, squashed_update, metadata, time.time()),
                    )

                # finally, write this update to the DB
                metadata = await self.get_metadata()
                await db.execute(
                    "INSERT INTO yupdates VALUES (?, ?, ?, ?)",
                    (path, data, metadata, time.time()),
                )
                await db.commit()

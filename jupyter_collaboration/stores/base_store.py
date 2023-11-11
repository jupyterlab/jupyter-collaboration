# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

from abc import ABC, abstractmethod
from inspect import isawaitable
from typing import AsyncIterator, Awaitable, Callable, cast

import y_py as Y
from anyio import Event


class BaseYStore(ABC):
    """
    Base class for the stores.
    """

    version = 3
    metadata_callback: Callable[[], Awaitable[bytes] | bytes] | None = None

    _store_path: str
    _initialized: Event | None = None

    @abstractmethod
    def __init__(
        self, path: str, metadata_callback: Callable[[], Awaitable[bytes] | bytes] | None = None
    ):
        """
        Initialize the object.

        Arguments:
            path: The path where the store will be located.
            metadata_callback: An optional callback to call to get the metadata.
            log: An optional logger.
        """
        ...

    @abstractmethod
    async def initialize(self) -> None:
        """
        Initializes the store.
        """
        ...

    @abstractmethod
    async def exists(self, path: str) -> bool:
        """
        Returns True if the document exists, else returns False.

        Arguments:
            path: The document name/path.
        """
        ...

    @abstractmethod
    async def list(self) -> AsyncIterator[str]:
        """
        Returns a list with the name/path of the documents stored.
        """
        ...

    @abstractmethod
    async def get(self, path: str, updates: bool = False) -> dict | None:
        """
        Returns the document's metadata or None if the document does't exist.

        Arguments:
            path: The document name/path.
            updates: Whether to return document's content or only the metadata.
        """
        ...

    @abstractmethod
    async def create(self, path: str, version: int) -> None:
        """
        Creates a new document.

        Arguments:
            path: The document name/path.
            version: Document version.
        """
        ...

    @abstractmethod
    async def remove(self, path: str) -> dict | None:
        """
        Removes a document.

        Arguments:
            path: The document name/path.
        """
        ...

    @abstractmethod
    async def write(self, path: str, data: bytes) -> None:
        """
        Store a document update.

        Arguments:
            path: The document name/path.
            data: The update to store.
        """
        ...

    @abstractmethod
    async def read(self, path: str) -> AsyncIterator[tuple[bytes, bytes]]:
        """
        Async iterator for reading document's updates.

        Arguments:
            path: The document name/path.

        Returns:
            A tuple of (update, metadata, timestamp) for each update.
        """
        ...

    @property
    def initialized(self) -> bool:
        if self._initialized is not None:
            return self._initialized.is_set()
        return False

    async def get_metadata(self) -> bytes:
        """
        Returns:
            The metadata.
        """
        if self.metadata_callback is None:
            return b""

        metadata = self.metadata_callback()
        if isawaitable(metadata):
            metadata = await metadata
        metadata = cast(bytes, metadata)
        return metadata

    async def encode_state_as_update(self, path: str, ydoc: Y.YDoc) -> None:
        """Store a YDoc state.

        Arguments:
            path: The document name/path.
            ydoc: The YDoc from which to store the state.
        """
        update = Y.encode_state_as_update(ydoc)  # type: ignore
        await self.write(path, update)

    async def apply_updates(self, path: str, ydoc: Y.YDoc) -> None:
        """Apply all stored updates to the YDoc.

        Arguments:
            path: The document name/path.
            ydoc: The YDoc on which to apply the updates.
        """
        async for update, *rest in self.read(path):  # type: ignore
            Y.apply_update(ydoc, update)  # type: ignore

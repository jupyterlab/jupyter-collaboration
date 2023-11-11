# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

from logging import Logger

from traitlets import Int, Unicode
from traitlets.config import LoggingConfigurable

from .file_store import FileYStore
from .sqlite_store import SQLiteYStore as _SQLiteYStore


class TempFileYStore(FileYStore):
    def __init__(self, log: Logger | None = None):
        super().__init__(path=".jupyter_store", log=log)


class SQLiteYStoreMetaclass(type(LoggingConfigurable), type(_SQLiteYStore)):  # type: ignore
    pass


class SQLiteYStore(LoggingConfigurable, _SQLiteYStore, metaclass=SQLiteYStoreMetaclass):
    db_path = Unicode(
        ".jupyter_store.db",
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

    def __init__(self, log: Logger | None = None):
        super().__init__(path=self.db_path, log=log)

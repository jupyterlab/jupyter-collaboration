# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from pycrdt_websocket.ystore import SQLiteYStore as _SQLiteYStore
from pycrdt_websocket.ystore import TempFileYStore as _TempFileYStore
from traitlets import Int, Unicode
from traitlets.config import LoggingConfigurable


class TempFileYStore(_TempFileYStore):
    prefix_dir = "jupyter_ystore_"


class SQLiteYStoreMetaclass(type(LoggingConfigurable), type(_SQLiteYStore)):  # type: ignore
    pass


class SQLiteYStore(LoggingConfigurable, _SQLiteYStore, metaclass=SQLiteYStoreMetaclass):
    db_path = Unicode(
        ".jupyter_ystore.db",
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

    history_length = Int(
        None,
        allow_none=True,
        config=True,
        help="""The maximum age (in seconds) of document history to retain.
                    Entries older than this window are automatically pruned.
                    Defaults to None (history is never cleared).""",
    )

    min_cleanup_interval = Int(
        60,
        config=True,
        help="""Minimum interval in seconds between automatic cleanup operations. Defaults to 60 seconds.""",
    )

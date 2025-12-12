# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from pycrdt.store import SQLiteYStore as _SQLiteYStore
from pycrdt.store import TempFileYStore as _TempFileYStore
from traitlets import Int, Unicode
from traitlets.config import LoggingConfigurable


class TempFileYStoreMetaclass(type(LoggingConfigurable), type(_TempFileYStore)):  # type: ignore
    pass


class TempFileYStore(LoggingConfigurable, _TempFileYStore, metaclass=TempFileYStoreMetaclass):
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

    squash_after_inactivity_of = Int(
        None,
        allow_none=True,
        config=True,
        help="""The document time-to-live in seconds. Defaults to None (document history is never
        cleared).""",
    )
    document_ttl = Int(
        None,
        allow_none=True,
        config=True,
        help="""The document time-to-live in seconds. Deprecated in favor of 'squash_after_inactivity_of'.
        Defaults to None (document history is never cleared).""",
    )

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

try:
    from jupyter_server.extension.application import ExtensionApp
except ModuleNotFoundError:
    raise ModuleNotFoundError("Jupyter Server must be installed to use this extension.")

from traitlets import Float, Int, Type, Unicode, observe
from ypy_websocket.ystore import BaseYStore, SQLiteYStore  # type: ignore

from .handlers import JupyterSQLiteYStore, YDocRoomIdHandler, YDocWebSocketHandler


class YDocExtension(ExtensionApp):

    name = "jupyter_server_ydoc"

    file_poll_interval = Int(
        1,
        config=True,
        help="""The period in seconds to check for file changes on disk.
        Defaults to 1s, if 0 then file changes will only be checked when
        saving changes from the front-end.""",
    )

    document_cleanup_delay = Int(
        60,
        allow_none=True,
        config=True,
        help="""The delay in seconds to keep a document in memory in the back-end after all clients
        disconnect. Defaults to 60s, if None then the document will be kept in memory forever.""",
    )

    document_save_delay = Float(
        1,
        allow_none=True,
        config=True,
        help="""The delay in seconds to wait after a change is made to a document before saving it.
        Defaults to 1s, if None then the document will never be saved.""",
    )

    ystore_class = Type(
        default_value=JupyterSQLiteYStore,
        klass=BaseYStore,
        config=True,
        help="""The YStore class to use for storing Y updates. Defaults to JupyterSQLiteYStore,
        which stores Y updates in a '.jupyter_ystore.db' SQLite database in the current
        directory, and clears history every 24 hours.""",
    )

    sqlite_ystore_db_path = Unicode(
        ".jupyter_ystore.db",
        config=True,
        help="""The path to the YStore database. Defaults to '.jupyter_ystore.db' in the current
        directory. Only applicable if the YStore is an SQLiteYStore.""",
    )

    @observe("sqlite_ystore_db_path")
    def _observe_sqlite_ystore_db_path(self, change):
        if issubclass(self.ystore_class, SQLiteYStore):
            self.ystore_class.db_path = change["new"]
        else:
            raise RuntimeError(
                f"ystore_class must be an SQLiteYStore to be able to set sqlite_ystore_db_path, not {self.ystore_class}"
            )

    sqlite_ystore_document_ttl = Int(
        None,
        allow_none=True,
        config=True,
        help="""The document time-to-live in seconds. Defaults to None (document history is never
        cleared). Only applicable if the YStore is an SQLiteYStore.""",
    )

    @observe("sqlite_ystore_document_ttl")
    def _observe_sqlite_ystore_document_ttl(self, change):
        if issubclass(self.ystore_class, SQLiteYStore):
            self.ystore_class.document_ttl = change["new"]
        else:
            raise RuntimeError(
                f"ystore_class must be an SQLiteYStore to be able to set sqlite_ystore_document_ttl, not {self.ystore_class}"
            )

    def initialize_settings(self):
        self.settings.update(
            {
                "collaborative_file_poll_interval": self.file_poll_interval,
                "collaborative_document_cleanup_delay": self.document_cleanup_delay,
                "collaborative_document_save_delay": self.document_save_delay,
                "collaborative_ystore_class": self.ystore_class,
            }
        )

    def initialize_handlers(self):
        self.handlers.extend(
            [
                (r"/api/yjs/roomid/(.*)", YDocRoomIdHandler),
                (r"/api/yjs/(.*)", YDocWebSocketHandler),
            ]
        )

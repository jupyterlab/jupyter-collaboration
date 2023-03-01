# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

try:
    from jupyter_server.extension.application import ExtensionApp
except ModuleNotFoundError:
    raise ModuleNotFoundError("Jupyter Server must be installed to use this extension.")

from traitlets import Float, Int, Type
from ypy_websocket.ystore import BaseYStore  # type: ignore

from .handlers import (
    DocSessionHandler,
    SQLiteYStore,
    YDocRoomIdHandler,
    YDocWebSocketHandler,
)


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
        default_value=SQLiteYStore,
        klass=BaseYStore,
        config=True,
        help="""The YStore class to use for storing Y updates. Defaults to an SQLiteYStore,
        which stores Y updates in a '.jupyter_ystore.db' SQLite database in the current
        directory.""",
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
                # Deprecated - to remove for 1.0.0
                (r"/api/yjs/roomid/(.*)", YDocRoomIdHandler),
                # Deprecated - to remove for 1.0.0
                (r"/api/yjs/session/(.*)", DocSessionHandler),
                # Deprecated - to remove for 1.0.0
                (r"/api/yjs/(.*)", YDocWebSocketHandler),
            ]
        )

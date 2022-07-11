from typing import Dict, List

import jupyter_server.serverapp

from ._version import __version__  # noqa:F401
from .ydoc import YDocWebSocketHandler


def _jupyter_server_extension_points() -> List[Dict[str, str]]:
    return [{"module": "jupyter_server_ydoc"}]


def _load_jupyter_server_extension(serverapp: jupyter_server.serverapp.ServerApp) -> None:
    handlers = [(r"/api/yjs/(.*)", YDocWebSocketHandler)]
    serverapp.web_app.add_handlers(".*$", handlers)

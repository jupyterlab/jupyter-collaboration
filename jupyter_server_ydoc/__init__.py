from typing import Dict, List

import jupyter_server.serverapp
from jupyter_server.utils import url_path_join

from ._version import __version__  # noqa:F401
from .ydoc import YDocWebSocketHandler


def _jupyter_server_extension_points() -> List[Dict[str, str]]:
    return [{"module": "jupyter_server_ydoc"}]


def _load_jupyter_server_extension(serverapp: jupyter_server.serverapp.ServerApp) -> None:
    web_app = serverapp.web_app
    host_pattern = ".*$"
    route_pattern = url_path_join(web_app.settings["base_url"], r"/api/yjs/(.*)")
    web_app.add_handlers(host_pattern, [(route_pattern, YDocWebSocketHandler)])

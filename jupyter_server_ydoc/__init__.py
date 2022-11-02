from typing import Dict, List

import jupyter_server.serverapp
from jupyter_server.utils import url_path_join

from .ydoc import YDocRoomIdHandler, YDocWebSocketHandler

__version__ = "0.2.0"


def _jupyter_server_extension_points() -> List[Dict[str, str]]:
    return [{"module": "jupyter_server_ydoc"}]


def _load_jupyter_server_extension(serverapp: jupyter_server.serverapp.ServerApp) -> None:
    web_app = serverapp.web_app
    host_pattern = ".*$"
    yid_route_pattern = url_path_join(web_app.settings["base_url"], r"/api/yjs/roomid/(.*)")
    yws_route_pattern = url_path_join(web_app.settings["base_url"], r"/api/yjs/(.*)")
    web_app.add_handlers(
        host_pattern,
        [
            (yid_route_pattern, YDocRoomIdHandler),
            (yws_route_pattern, YDocWebSocketHandler),
        ],
    )


# Backward compatibility for classic notebook based start-up (e.g. Binder)
load_jupyter_server_extension = _load_jupyter_server_extension

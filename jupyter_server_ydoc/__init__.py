from typing import Any, Dict, List

from .app import YDocExtension

__version__ = "0.7.0"

def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "@jupyterlab/rtc-extension"
    }]


def _jupyter_server_extension_points() -> List[Dict[str, Any]]:
    return [{"module": "jupyter_server_ydoc", "app": YDocExtension}]

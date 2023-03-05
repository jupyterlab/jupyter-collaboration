from typing import Any, Dict, List

from .app import YDocExtension

__version__ = "0.8.0"


def _jupyter_server_extension_points() -> List[Dict[str, Any]]:
    return [{"module": "jupyter_server_ydoc", "app": YDocExtension}]

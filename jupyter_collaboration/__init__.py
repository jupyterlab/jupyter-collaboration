# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from typing import Any, Dict, List

from ._version import __version__  # noqa
from .app import YDocExtension


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "@jupyter/collaboration-extension"}]


def _jupyter_server_extension_points() -> List[Dict[str, Any]]:
    return [{"module": "jupyter_collaboration", "app": YDocExtension}]

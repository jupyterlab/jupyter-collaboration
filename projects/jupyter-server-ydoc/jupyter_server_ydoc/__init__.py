# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from typing import Any

from ._version import __version__  # noqa
from .app import YDocExtension


def _jupyter_server_extension_points() -> list[dict[str, Any]]:
    return [{"module": "jupyter_server_ydoc", "app": YDocExtension}]

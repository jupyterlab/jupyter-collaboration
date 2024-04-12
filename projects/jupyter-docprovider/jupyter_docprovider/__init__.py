# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from ._version import __version__  # noqa


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "@jupyter/collaboration-extension"}]

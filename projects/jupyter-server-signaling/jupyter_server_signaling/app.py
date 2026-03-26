# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.
from __future__ import annotations

from jupyter_server.extension.application import ExtensionApp
from traitlets import Unicode

from .handlers import SignalingWebSocketHandler


class SignalingExtension(ExtensionApp):
    name = "jupyter_server_signaling"
    app_name = "Jupyter Server Signaling"
    description = """
    Enables discovery of peers connected through WebRTC
    """

    def initialize_handlers(self):
        self.handlers.append(("/api/signaling", SignalingWebSocketHandler))

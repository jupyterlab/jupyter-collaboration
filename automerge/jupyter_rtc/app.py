import os
import jinja2

from jupyter_server.extension.application import ExtensionApp, ExtensionAppJinjaMixin
from jupyter_server.utils import url_path_join

from .handlers import DefaultHandler, RouteHandler, AutomergeWsHandler


class JupyterRTCApp(ExtensionApp):
    # The name of the extension.
    name = "jupyter_rtc"

    # The url that your extension will serve its homepage.
    extension_url = '/jupyter_rtc/default'

    # Should your extension expose other server extensions when launched directly?
    load_other_extensions = True

    def initialize_settings(self):
        self.log.info(f'{self.name} is enabled.')

    def initialize_handlers(self):
        host_pattern = ".*$"
        base_url = self.settings["base_url"]
        route_pattern = url_path_join(base_url, "jupyter_rtc", "get_example")
        ws_pattern = url_path_join(base_url, "jupyter_rtc", "websocket")
#        self.handlers.extend([
#            (r'/{}/default'.format(self.name), DefaultHandler),
#            (route_pattern, RouteHandler),
#            (ws_pattern, AutomergeWsHandler),
#        ])
        self.handlers.extend([
            (r'/jupyter_rtc/default', DefaultHandler),
            (r'/jupyter_rtc/get_example', RouteHandler),
            (r'/jupyter_rtc/websocket', AutomergeWsHandler),
        ])

# Entry Point Definition

main = launch_new_instance = JupyterRTCApp.launch_instance

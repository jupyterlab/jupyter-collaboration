import os
import jinja2

from jupyter_server.extension.application import ExtensionApp, ExtensionAppJinjaMixin
from jupyter_server.utils import url_path_join

from .handlers import DefaultHandler, ExampleHandler, CollaborationWsHandler


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
#        example_pattern = url_path_join(base_url, "jupyter_rtc", "example")
        self.handlers.extend([
            (r'/{}/default'.format(self.name), DefaultHandler),
            (r'/{}/example'.format(self.name), ExampleHandler),
            (r'/{}/collaboration'.format(self.name), CollaborationWsHandler),
        ])

# Entry Point Definition
main = launch_new_instance = JupyterRTCApp.launch_instance

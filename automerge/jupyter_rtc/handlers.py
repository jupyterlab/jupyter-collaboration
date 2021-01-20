from jupyter_server.base.handlers import JupyterHandler, APIHandler
from jupyter_server.extension.handler import ExtensionHandlerMixin, ExtensionHandlerJinjaMixin
from jupyter_server.base.zmqhandlers import WebSocketMixin

import tornado
from tornado.websocket import WebSocketHandler, websocket_connect
from tornado.ioloop import IOLoop

import json

import jupyter_rtc_automerge as jrtcam


class RouteHandler(APIHandler):
    # The following decorator should be present on all verb methods (head, get, post,
    # patch, put, delete, options) to ensure only authorized user can request the
    # Jupyter server
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "data": "This is /jupyter_rtc/get_example endpoint!"
        }))


class DefaultHandler(ExtensionHandlerMixin, JupyterHandler):
    def get(self):
        # The name of the extension to which this handler is linked.
        self.log.info("Extension Name in {} Default Handler: {}".format(
            self.name, self.name))
        self.write('<h1>Jupyter RTC Extension</h1>')
        self.write('Config in {} Default Handler: {}'.format(
            self.name, self.config))


shared_automerge_rooms = {}


class AutomergeRoom:

    def __init__(self, doc):

        self.docname = doc
        self.websockets = []
        self.automerge_backend = jrtcam.automerge.new_backend()
        print("Room init, document : ", self.automerge_backend)

    def add_websocket(self, ws):
        self.websockets.append(ws)

    def remove_websocket(self, ws):
        self.websockets.remove(ws)

    def get_changes(self):
        return jrtcam.automerge.get_changes(self.automerge_backend)

    def dispatch_message(self, message, sender=None):

        # Forward the message to the automerge document
        self.automerge_backend = jrtcam.automerge.apply_change(
            self.automerge_backend, message)

        payload = json.dumps([list(message)])

        for ws in self.websockets:
            if ws != sender:
                ws.write_message(payload)


class AutomergeWsHandler(WebSocketMixin, WebSocketHandler, ExtensionHandlerMixin, JupyterHandler):

    async def open(self):

        doc = self.get_argument('doc', default=None)
        print(f"\nDEBUG {self.request}, {self.request.remote_ip}  \n")

        if doc not in shared_automerge_rooms:
            shared_automerge_rooms[doc] = AutomergeRoom(doc)

        shared_automerge_rooms[doc].add_websocket(self)
        print(
            f"\nDEBUG shared websockets for doc {doc} : {shared_automerge_rooms[doc]}")

        print("Websocket open : ",
              shared_automerge_rooms[doc].automerge_backend)

        changes = shared_automerge_rooms[doc].get_changes()
        payload = json.dumps(changes)
        self.write_message(payload)

    def on_message(self, message,  *args, **kwargs):

        doc = self.get_argument('doc', default=None)
        if doc not in shared_automerge_rooms:
            print(
                f"WEIRD : on_message for {doc} not in shared_automerge_rooms")
            return

        shared_automerge_rooms[doc].dispatch_message(message, sender=self)

    def on_close(self,  *args, **kwargs):
        doc = self.get_argument('doc', default=None)

        print(f"WebSocket on close for {doc}")
        if doc in shared_automerge_rooms:
            shared_automerge_rooms[doc].remove_websocket(self)

import json

import tornado
from tornado.websocket import WebSocketHandler, websocket_connect
from tornado.ioloop import IOLoop

from jupyter_server.base.handlers import JupyterHandler, APIHandler
from jupyter_server.extension.handler import ExtensionHandlerMixin, ExtensionHandlerJinjaMixin
from jupyter_server.base.zmqhandlers import WebSocketMixin

from jupyter_rtc_automerge import textarea


collaborations = {}


class Collaboration:

    def __init__(self, doc):
        self.docname = doc
        self.websockets = []
        self.document = textarea.new_document(doc, f'Hello from Python! I am doc: {doc}')
        print("Room init, document : ", self.document)

    def get_all_changes(self):
        return textarea.get_all_changes(self.document)

    def add_websocket(self, ws):
        self.websockets.append(ws)

    def remove_websocket(self, ws):
        self.websockets.remove(ws)

    def dispatch_message(self, message, sender=None):
        j = json.loads(message)
        print(j)
        if (j['action'] == 'change'):
            message_bytes = list(j['changes'][0].values())
            self.document = textarea.apply_changes(self.document, message_bytes)
        for ws in self.websockets:
            if ws != sender:
                ws.write_message(message)


class DefaultHandler(ExtensionHandlerMixin, JupyterHandler):
    @tornado.web.authenticated
    def get(self):
        # The name of the extension to which this handler is linked.
        self.log.info("Extension Name in {} Default Handler: {}".format(
            self.name, self.name))
        self.write('<h1>Jupyter RTC Extension</h1>')
        self.write('Config in {} Default Handler: {}'.format(
            self.name, self.config))


class ExampleHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "data": "This is /jupyter_rtc/example endpoint!"
        }))


class CollaborationWsHandler(WebSocketMixin, WebSocketHandler, ExtensionHandlerMixin, JupyterHandler):

    async def open(self):
        doc = self.get_argument('doc', default=None)
        print(f"\nDEBUG {self.request}, {self.request.remote_ip}  \n")
        if doc not in collaborations:
            collaborations[doc] = Collaboration(doc)
        collaborations[doc].add_websocket(self)
        print(f"\nDEBUG shared websockets for doc {doc} : {collaborations[doc]}")
        print("Websocket open", collaborations[doc].document)
        changes = collaborations[doc].get_all_changes()
        payload = json.dumps({'action': 'init', 'changes': changes})
        self.write_message(payload)

    def on_message(self, message,  *args, **kwargs):
        doc = self.get_argument('doc', default=None)
        if doc not in collaborations:
            print(f"WEIRD : on_message for {doc} not in collaborations")
            return
        collaborations[doc].dispatch_message(message, sender=self)

    def on_close(self,  *args, **kwargs):
        doc = self.get_argument('doc', default=None)
        print(f"WebSocket on close for {doc}")
        if doc in collaborations:
            collaborations[doc].remove_websocket(self)

import json

import tornado
from tornado.websocket import WebSocketHandler, websocket_connect
from tornado.ioloop import IOLoop

from jupyter_server.base.handlers import JupyterHandler, APIHandler
from jupyter_server.extension.handler import ExtensionHandlerMixin, ExtensionHandlerJinjaMixin
from jupyter_server.base.zmqhandlers import WebSocketMixin

from jupyter_rtc_automerge import textarea


rooms = {}


class Room:

    def __init__(self, room, text):
        self.room = room
        self.websockets = []
        self.document = textarea.new_document(room, text)
        print("Room initialized with text:", text)
        print("Room initialized with document:", self.document)


    def get_all_changes(self):
        return textarea.get_all_changes(self.document)


    def add_websocket(self, ws):
        self.websockets.append(ws)


    def remove_websocket(self, ws):
        self.websockets.remove(ws)


    def broadcast_to_users(self, message, sender=None):
        for ws in self.websockets:
            if ws != sender:
                ws.write_message(message)

    def process_message(self, message, sender=None):
        m = json.loads(message)
        print(f'process_message: {m}')
        action = m['action']
        if action == 'get_all_changes':
            changes = self.get_all_changes()
            message = json.dumps({'action': 'all_changes', 'changes': changes})
            sender.write_message(message)
            return
        if action == 'change':
            m_bytes = list(m['changes'][0].values())
            self.document = textarea.apply_changes(self.document, m_bytes)
        self.broadcast_to_users(message, sender)


class DefaultHandler(ExtensionHandlerMixin, JupyterHandler):
    @tornado.web.authenticated
    def get(self):
        self.log.info("Extension Name in {} Default Handler: {}".format(
            self.name, self.name))
        self.write('<h1>JupyterLab RTC Extension</h1>')
        self.write('Config in {} Default Handler: {}'.format(
            self.name, self.config))


class ExampleHandler(APIHandler):
    @tornado.web.authenticated
    def get(self):
        self.finish(json.dumps({
            "data": "This is /jupyter_rtc/example endpoint!"
        }))


class WsRTCManager(WebSocketMixin, WebSocketHandler, ExtensionHandlerMixin, JupyterHandler):


    DEFAULT_ROOM = '_default_'
    USERS_ROOM = '_users_'


    async def open(self):
        room = self.get_argument('room', default=self.DEFAULT_ROOM)
        print(f"WebSocket open {self.request}, {self.request.remote_ip}")
        if room == self.USERS_ROOM:
            if room not in rooms:
                rooms[room] = Room(room, '')
            rooms[room].add_websocket(self)
            message = json.dumps({'action': 'ack'})
            self.write_message(message)
            return
        action = 'change'
        if room not in rooms:
            action = 'init'
            content = self.get_content(room)
            rooms[room] = Room(room, content)
        rooms[room].add_websocket(self)
        print(f"Websocket open {room}: {rooms[room].document}")
        changes = rooms[room].get_all_changes()
        message = json.dumps({'action': action, 'changes': changes})
        self.write_message(message)


    def on_message(self, message,  *args, **kwargs):
        room = self.get_argument('room', default=self.DEFAULT_ROOM)
        if room == self.USERS_ROOM:
            rooms[room].broadcast_to_users(message, sender=self)
            return
        if room not in rooms:
            print(f"WEIRD on_message: {room} is not in rooms")
            return
        rooms[room].process_message(message, sender=self)


    def on_close(self,  *args, **kwargs):
        room = self.get_argument('room', default=None)
        print(f"WebSocket on_close for {room}")
        if room in rooms:
            rooms[room].remove_websocket(self)


    def get_content(self, path):
        model = self.contents_manager.get(
            path=path, type='file', format='text', content='1',
        )
        return model['content']

# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import asyncio
import json
from typing import Dict, Set

from jupyter_server.base.handlers import JupyterHandler
from tornado import web
from tornado.websocket import WebSocketHandler


class SignalingWebSocketHandler(WebSocketHandler, JupyterHandler):
    _topics: Dict[str, Set["SignalingWebSocketHandler"]] = {}

    async def get(self, *args, **kwargs):
        """
        Overrides default behavior to check whether the client is authenticated or not.
        """
        if self.current_user is None:
            self.log.warning("Couldn't authenticate WebSocket connection")
            raise web.HTTPError(403)
        return await super().get(*args, **kwargs)

    def open(self):
        self._closed = False
        self._pong_received = True
        self._subscribed_topics = set()
        self._ping_timeout = 30
        self._ping_interval_task = asyncio.create_task(self._ping_interval())

    async def _ping_interval(self):
        # Check if connection is still alive
        while True:
            await asyncio.sleep(self._ping_timeout)
            if self._pong_received:
                self._pong_received = False
                try:
                    self.ping()
                except Exception:
                    self.close()
            else:
                self.close()
                self._ping_interval_task.cancel()

    def on_pong(self, data: bytes) -> None:
        self._pong_received = True

    def on_close(self) -> None:
        for topic_name in self._subscribed_topics:
            subs = self._topics.get(topic_name, set())
            if self in subs:
                subs.remove(self)
            if len(subs) == 0:
                del self._topics[topic_name]
        self._subscribed_topics.clear()
        self._closed = True

    async def on_message(self, message):
        message = json.loads(message)
        if "type" in message and not self._closed:
            message_type = message["type"]
            if message_type == "subscribe":
                for topic_name in message["topics"]:
                    topic = self._topics.setdefault(topic_name, set())
                    topic.add(self)
                    self._subscribed_topics.add(topic_name)
            elif message_type == "unsubscribe":
                for topic_name in message["topics"]:
                    subs = self._topics.get(topic_name)
                    if subs is not None and self in subs:
                        subs.remove(self)

            elif message_type == "publish":
                if "topic" in message:
                    receivers = self._topics.get(message["topic"])
                    if receivers:
                        message["clients"] = len(receivers)
                        for receiver in receivers:
                            receiver.write_message(message)
            elif message_type == "ping":
                self.write_message({"type": "pong"})

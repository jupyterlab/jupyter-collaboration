# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

# TODO: remove this module in favor of the one in jupyter_ydoc when released.

import json
import jupyter_ydoc
from functools import partial
from typing import Any, Callable, List
from pycrdt import Array, Map


class YChat(jupyter_ydoc.YBaseDoc):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._ydoc["content"] = self._ycontent = Map()
        self._ydoc["messages"] = self._ymessages = Array()

    @property
    def version(self) -> str:
        """
        Returns the version of the document.
        :return: Document's version.
        :rtype: str
        """
        return "1.0.0"

    @property
    def messages(self) -> List:
        return self._ymessages.to_py()

    def get(self) -> str:
        """
        Returns the messages of the document.
        :return: Document's messages.
        :rtype: Any
        """

        messages = self._ymessages.to_py()
        data = dict(messages=messages)
        return json.dumps(data, indent=2, sort_keys=True)

    def set(self, value: str) -> None:
        """
        Sets the content of the document.
        :param value: The content of the document.
        :type value: str
        """
        contents = json.loads(value)
        if "messages" in contents.keys():
            with self._ydoc.transaction():
                for v in contents["messages"]:
                    self._ymessages.append(v)

    def observe(self, callback: Callable[[str, Any], None]) -> None:
        self.unobserve()
        self._subscriptions[self._ystate] = self._ystate.observe(partial(callback, "state"))
        self._subscriptions[self._ymessages] = self._ymessages.observe(
            partial(callback, "messages")
        )
        self._subscriptions[self._ycontent] = self._ycontent.observe(partial(callback, "content"))


# Register the ydoc
jupyter_ydoc.ydocs["jupyter_collaboration.chat_ydoc:YChat"] = YChat

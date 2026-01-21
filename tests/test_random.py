# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import sys
from collections import Counter
from functools import partial
from random import randrange, uniform

if sys.version_info < (3, 10):
    from importlib_metadata import entry_points
else:
    from importlib.metadata import entry_points

from anyio import TASK_STATUS_IGNORED, Event, create_task_group, sleep
from anyio.abc import TaskStatus
from pycrdt import Text
from pycrdt_websocket import WebsocketProvider

jupyter_ydocs = {ep.name: ep.load() for ep in entry_points(group="jupyter_ydoc")}


async def test_random(
    rtc_create_file,
    rtc_connect_doc_client,
):
    test_duration = 10
    client_nb = 10
    change_max_delay = 0.5

    file_format = "text"
    file_type = "file"
    file_path = "untitled.txt"
    await rtc_create_file(file_path)
    ref_ydoc = jupyter_ydocs[file_type]()
    ref_ytext = ref_ydoc.ydoc.get("source", type=Text)

    async def connect(
        file_format: str,
        file_type: str,
        file_path: str,
        ref_ytext: Text,
        stop_request: Event,
        do_stop: Event,
        *,
        task_status: TaskStatus[None] = TASK_STATUS_IGNORED,
    ) -> None:
        await sleep(uniform(0, 1))
        async with await rtc_connect_doc_client(file_format, file_type, file_path) as ws:
            jupyter_ydoc = jupyter_ydocs[file_type]()
            ydoc = jupyter_ydoc.ydoc
            ytext = ydoc.get("source", type=Text)
            stop_ready = Event()
            stop_done = Event()
            task_status.started({"ytext": ytext, "stop_ready": stop_ready, "stop_done": stop_done})
            async with WebsocketProvider(ydoc, ws):
                while True:
                    if stop_request.is_set():
                        stop_ready.set()
                        await do_stop.wait()
                        # allow some time for last messages to arrive through websocket
                        # FIXME: how long?
                        await sleep(10)
                        stop_done.set()
                        return
                    await sleep(uniform(0, change_max_delay))
                    length = len(ytext)
                    index = 0 if length == 0 else randrange(length)
                    character = chr(randrange(32, 127))
                    ytext.insert(index, character)
                    ref_ytext.insert(index, character)

    stop_request = Event()
    do_stop = Event()
    connect = partial(connect, file_format, file_type, file_path, ref_ytext, stop_request, do_stop)
    try:
        async with create_task_group() as tg:
            clients = [await tg.start(connect) for i in range(client_nb)]
            await sleep(test_duration)
            stop_request.set()
            for client in clients:
                await client["stop_ready"].wait()
            do_stop.set()
            for client in clients:
                await client["stop_done"].wait()
    except Exception as e:
        print(f"{e=}")

    await sleep(1)
    ref_text = str(ref_ytext)
    text0 = str(clients[0]["ytext"])
    # check that the first peer has all the changes of the reference
    # (but not necessarily in the same order)
    assert Counter(ref_text) == Counter(text0)
    # check that all peers have the same content
    for client in clients[1:]:
        text = str(client["ytext"])
        assert text == text0

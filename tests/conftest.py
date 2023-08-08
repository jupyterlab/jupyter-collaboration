# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

import json
from asyncio import Event, sleep
from distutils.dir_util import copy_tree
from pathlib import Path
from typing import Any

import nbformat
import pytest
from jupyter_ydoc import YNotebook, YUnicode
from websockets import connect
from ypy_websocket import WebsocketProvider

pytest_plugins = ["jupyter_server.pytest_plugin"]

HERE = Path(__file__).parent.resolve()
RESOURCES_PATH = f"{HERE}/resources"


@pytest.fixture
def jp_server_config(jp_root_dir, jp_server_config):
    return {
        "ServerApp": {
            "jpserver_extensions": {"jupyter_collaboration": True, "jupyter_server_fileid": True},
            "token": "",
            "password": "",
            "disable_check_xsrf": True,
        },
        "SQLiteYStore": {"db_path": str(jp_root_dir.joinpath(".rtc_test.db"))},
    }


@pytest.fixture(autouse=True)
def rtc_move_resources(jp_root_dir):
    copy_tree(RESOURCES_PATH, str(jp_root_dir))


@pytest.fixture
def rtc_create_file(jp_root_dir, jp_serverapp, rtc_add_doc_to_store):
    """Creates a text file in the test's home directory."""
    fim = jp_serverapp.web_app.settings["file_id_manager"]

    async def _inner(path: str, content: str = None, index=False, store=False) -> (str, str):
        file_path = jp_root_dir.joinpath(path)
        # If the file path has a parent directory, make sure it's created.
        parent = file_path.parent
        parent.mkdir(parents=True, exist_ok=True)

        if content == None:
            content = ""

        file_path.write_text(content)

        if index:
            fim.index(path)

        if store:
            await rtc_add_doc_to_store("text", "file", path)

        return path, content

    return _inner


@pytest.fixture
def rtc_create_notebook(jp_root_dir, jp_serverapp):
    """Creates a notebook in the test's home directory."""
    fim = jp_serverapp.web_app.settings["file_id_manager"]

    async def _inner(path: str, content: str = None, index=False, store=False) -> (str, str):
        nbpath = jp_root_dir.joinpath(path)
        # Check that the notebook has the correct file extension.
        if nbpath.suffix != ".ipynb":
            msg = "File extension for notebook must be .ipynb"
            raise Exception(msg)
        # If the notebook path has a parent directory, make sure it's created.
        parent = nbpath.parent
        parent.mkdir(parents=True, exist_ok=True)

        # Create a notebook string and write to file.
        if content == None:
            nb = nbformat.v4.new_notebook()
            content = nbformat.writes(nb, version=4)

        nbpath.write_text(content)

        if index:
            fim.index(path)

        if store:
            await rtc_add_doc_to_store("json", "notebook", path)

        return path, content

    return _inner


@pytest.fixture
def rtc_fetch_session(jp_fetch):
    def _inner(format: str, type: str, path: str):
        return jp_fetch(
            "/api/collaboration/session",
            path,
            method="PUT",
            body=json.dumps({"format": format, "type": type}),
        )

    return _inner


@pytest.fixture
def rtc_connect_awareness_client(jp_http_port, jp_base_url):
    async def _inner(room_id: str):
        return connect(
            f"ws://127.0.0.1:{jp_http_port}{jp_base_url}api/collaboration/room/{room_id}"
        )

    return _inner


@pytest.fixture
def rtc_connect_doc_client(jp_http_port, jp_base_url, rtc_fetch_session):
    async def _inner(format: str, type: str, path: str):
        resp = await rtc_fetch_session(format, type, path)
        data = json.loads(resp.body.decode("utf-8"))
        return connect(
            f"ws://127.0.0.1:{jp_http_port}{jp_base_url}api/collaboration/room/{data['format']}:{data['type']}:{data['fileId']}?sessionId={data['sessionId']}"
        )

    return _inner


@pytest.fixture
def rtc_add_doc_to_store(rtc_connect_doc_client):
    event = Event()

    def _on_document_change(target: str, e: Any) -> None:
        if target == "source":
            event.set()

    async def _inner(format: str, type: str, path: str):
        if type == "notebook":
            doc = YNotebook()
        else:
            doc = YUnicode()

        doc.observe(_on_document_change)

        async with await rtc_connect_doc_client(format, type, path) as ws, WebsocketProvider(
            doc.ydoc, ws
        ):
            await event.wait()
            await sleep(0.1)

    return _inner

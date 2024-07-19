# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import nbformat
import pytest
from jupyter_server_ydoc.pytest_plugin import rtc_create_SQLite_store_factory
from jupyter_server_ydoc.stores import SQLiteYStore, TempFileYStore


def test_default_settings(jp_serverapp):
    settings = jp_serverapp.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["disable_rtc"] is False
    assert settings["file_poll_interval"] == 1
    assert settings["document_cleanup_delay"] == 60
    assert settings["document_save_delay"] == 1
    assert settings["ystore_class"] == SQLiteYStore


def test_settings_should_disable_rtc(jp_configurable_serverapp):
    argv = ["--YDocExtension.disable_rtc=True"]

    app = jp_configurable_serverapp(argv=argv)
    settings = app.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["disable_rtc"] is True


def test_settings_should_change_file_poll(jp_configurable_serverapp):
    argv = ["--YDocExtension.file_poll_interval=2"]

    app = jp_configurable_serverapp(argv=argv)
    settings = app.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["file_poll_interval"] == 2


def test_settings_should_change_document_cleanup(jp_configurable_serverapp):
    argv = ["--YDocExtension.document_cleanup_delay=10"]

    app = jp_configurable_serverapp(argv=argv)
    settings = app.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["document_cleanup_delay"] == 10


def test_settings_should_change_save_delay(jp_configurable_serverapp):
    argv = ["--YDocExtension.document_save_delay=10"]

    app = jp_configurable_serverapp(argv=argv)
    settings = app.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["document_save_delay"] == 10


def test_settings_should_change_ystore_class(jp_configurable_serverapp):
    argv = ["--YDocExtension.ystore_class=jupyter_server_ydoc.stores.TempFileYStore"]

    app = jp_configurable_serverapp(argv=argv)
    settings = app.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["ystore_class"] == TempFileYStore


async def test_document_ttl_from_settings(rtc_create_mock_document_room, jp_configurable_serverapp):
    argv = ["--SQLiteYStore.document_ttl=3600"]

    app = jp_configurable_serverapp(argv=argv)

    id = "test-id"
    content = "test_ttl"
    rtc_create_SQLite_store = rtc_create_SQLite_store_factory(app)
    store = await rtc_create_SQLite_store("file", id, content)

    assert store.document_ttl == 3600


@pytest.mark.parametrize("copy", [True, False])
async def test_get_document_file(rtc_create_file, jp_serverapp, copy):
    path, content = await rtc_create_file("test.txt", "test", store=True)
    collaboration = jp_serverapp.web_app.settings["jupyter_server_ydoc"]
    document = await collaboration.get_document(
        path=path, content_type="file", file_format="text", copy=copy
    )
    assert document.get() == content == "test"
    await collaboration.stop_extension()


@pytest.mark.parametrize("copy", [True, False])
async def test_get_document_notebook(rtc_create_notebook, jp_serverapp, copy):
    nb = nbformat.v4.new_notebook(
        cells=[nbformat.v4.new_code_cell(source="1+1", execution_count=99)]
    )
    nb_content = nbformat.writes(nb, version=4)
    path, _ = await rtc_create_notebook("test.ipynb", nb_content, store=True)
    collaboration = jp_serverapp.web_app.settings["jupyter_server_ydoc"]
    document = await collaboration.get_document(
        path=path, content_type="notebook", file_format="json", copy=copy
    )
    doc = document.get()
    assert len(doc["cells"]) == 1
    cell = doc["cells"][0]
    assert cell["source"] == "1+1"
    assert cell["execution_count"] == 99
    await collaboration.stop_extension()


async def test_get_document_file_copy_is_independent(
    rtc_create_file, jp_serverapp, rtc_fetch_session
):
    path, content = await rtc_create_file("test.txt", "test", store=True)
    collaboration = jp_serverapp.web_app.settings["jupyter_server_ydoc"]
    document = await collaboration.get_document(
        path=path, content_type="file", file_format="text", copy=True
    )
    document.set("other")
    fresh_copy = await collaboration.get_document(
        path=path, content_type="file", file_format="text"
    )
    assert fresh_copy.get() == "test"
    await collaboration.stop_extension()

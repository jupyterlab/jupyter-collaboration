# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

from __future__ import annotations

import nbformat
import pytest
from jupyter_server.services.contents.filemanager import FileContentsManager
from jupyter_server_ydoc.app import YDocExtension
from jupyter_server_ydoc.pytest_plugin import rtc_create_SQLite_store_factory
from jupyter_server_ydoc.stores import SQLiteYStore, TempFileYStore
from traitlets import TraitError


@pytest.fixture
def jp_server_config(jp_server_config, request):
    # Avoid collecting thread-affine pycrdt events in contents I/O workers.
    # This is a test workaround for pycrdt's cross-thread GC failure.
    if request.node.originalname == "test_get_document_notebook":
        jp_server_config["ServerApp"]["contents_manager_class"] = FileContentsManager
    if request.node.originalname == "test_get_document_reloads_external_changes_in_place":
        jp_server_config["YDocExtension"]["file_poll_interval"] = 0
        jp_server_config["YDocExtension"]["behavior_on_external_change"] = "overwrite"
    return jp_server_config


def test_default_settings(jp_serverapp):
    settings = jp_serverapp.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["behavior_on_external_change"] == "overwrite"
    assert settings["disable_rtc"] is False
    assert settings["file_poll_interval"] == 1
    assert settings["document_cleanup_delay"] == 60
    assert settings["document_save_delay"] == 1
    assert settings["document_load_progressively"] is False
    assert settings["notebook_output_delay_threshold_mb"] == 100
    assert settings["ystore_class"] == SQLiteYStore


@pytest.mark.parametrize("behavior", ["ask", "overwrite"])
def test_settings_should_configure_external_changes(jp_configurable_serverapp, behavior):
    app = jp_configurable_serverapp(
        argv=[f"--YDocExtension.behavior_on_external_change={behavior}"]
    )
    settings = app.web_app.settings["jupyter_server_ydoc_config"]
    assert settings["behavior_on_external_change"] == behavior
    assert app.web_app.settings["collaborative_behavior_on_external_change"] == behavior


@pytest.mark.parametrize("behavior", ["auto", "invalid", True])
def test_settings_reject_unsupported_external_change_behavior(behavior):
    with pytest.raises(TraitError, match="behavior_on_external_change"):
        YDocExtension(behavior_on_external_change=behavior)


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


def test_settings_should_change_document_progressive_loading(jp_configurable_serverapp):
    argv = ["--YDocExtension.document_load_progressively=True"]

    app = jp_configurable_serverapp(argv=argv)
    settings = app.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["document_load_progressively"] is True


def test_settings_should_change_notebook_output_delay_threshold(jp_configurable_serverapp):
    argv = ["--YDocExtension.notebook_output_delay_threshold_mb=50"]

    app = jp_configurable_serverapp(argv=argv)
    settings = app.web_app.settings["jupyter_server_ydoc_config"]

    assert settings["notebook_output_delay_threshold_mb"] == 50


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

    # document_ttl is deprecated and mapped to squash_after_inactivity_of
    assert store.squash_after_inactivity_of == 3600


async def test_squash_after_inactivity_of_from_settings(
    rtc_create_mock_document_room, jp_configurable_serverapp
):
    argv = ["--SQLiteYStore.squash_after_inactivity_of=3600"]

    app = jp_configurable_serverapp(argv=argv)

    id = "test-id"
    content = "test_ttl"
    rtc_create_SQLite_store = rtc_create_SQLite_store_factory(app)
    store = await rtc_create_SQLite_store("file", id, content)

    assert store.squash_after_inactivity_of == 3600


@pytest.mark.parametrize("copy", [True, False])
async def test_get_document_file(rtc_create_file, jp_serverapp, copy):
    path, content = await rtc_create_file("test.txt", "test", store=True)
    collaboration = jp_serverapp.web_app.settings["jupyter_server_ydoc"]
    document = await collaboration.get_document(
        path=path, content_type="file", file_format="text", copy=copy
    )
    assert document.get() == content == "test"
    await collaboration.stop_extension()


async def test_get_document_create_room(rtc_create_file, jp_serverapp):
    path, content = await rtc_create_file("test.txt", "test", index=True)
    collaboration = jp_serverapp.web_app.settings["jupyter_server_ydoc"]
    # Document doesn't exist initially
    document_before = await collaboration.get_document(
        path=path, content_type="file", file_format="text", create=False
    )
    assert document_before is None

    document_after = await collaboration.get_document(
        path=path, content_type="file", file_format="text", create=True
    )
    # Verify document was created and has correct content
    assert document_after is not None
    assert document_after.get() == content == "test"
    await collaboration.stop_extension()


# Only ignore the expected warning for the explicit synchronous test manager;
# pycrdt unraisable exceptions must still fail the test.
@pytest.mark.filterwarnings(
    "ignore:The synchronous ContentsManager classes are deprecated:DeprecationWarning"
)
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


@pytest.mark.parametrize("create_via_websocket", [False, True])
async def test_get_document_reloads_external_changes_in_place(
    rtc_create_file, jp_serverapp, create_via_websocket
):
    path, _ = await rtc_create_file(
        "reload.txt", "original", index=True, store=create_via_websocket
    )
    collaboration = jp_serverapp.web_app.settings["jupyter_server_ydoc"]
    document = await collaboration.get_document(
        path=path, content_type="file", file_format="text", copy=False, create=True
    )
    file_ids = jp_serverapp.web_app.settings["file_id_manager"]
    file_id = file_ids.get_id(path)
    try:
        document.source = "unsaved edits"
        await jp_serverapp.contents_manager.save(
            {"type": "file", "format": "text", "content": "disk version"}, path
        )
        await collaboration.file_loaders[file_id].maybe_notify()
        assert await document.aget() == "disk version"
        assert not document.dirty
        assert file_ids.get_id(path) == file_id
        reopened = await collaboration.get_document(
            path=path, content_type="file", file_format="text", copy=False
        )
        assert reopened is document
    finally:
        await collaboration.stop_extension()

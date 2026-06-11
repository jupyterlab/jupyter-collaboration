# Copyright (c) Jupyter Development Team.
# Distributed under the terms of the Modified BSD License.

"""Server configuration for integration tests.

!! Never use this configuration in production because it
opens the server to the world and provide access to JupyterLab
JavaScript objects through the global window variable.
"""

from typing import Any, cast

from jupyterlab.galata import configure_jupyter_server

# `c` is injected by jupyter-server while loading this config file.
c = cast(Any, globals()["c"])
configure_jupyter_server(c)  # noqa

# Fast room eviction so conflict tests don't need to wait 60 seconds.
c.YDocExtension.document_cleanup_delay = 1

# Keep the delayed-output path observable in UI tests without oversized
# notebook fixtures.
c.YDocExtension.notebook_load_progressively = True
c.YDocExtension.notebook_output_delay_threshold_mb = 7

# Force-close dead WebSocket connections quickly.  Playwright's setOffline(true)
# blocks network I/O without tearing down existing TCP connections, so pings are
# needed to make the server detect the disconnection.  The conflict test goes
# offline for 10 s; with interval=2 + timeout=5 the dead connection closes ≤7 s
# after going offline, leaving enough margin before the test comes back online.
c.ServerApp.websocket_ping_interval = 2  # seconds between pings
c.ServerApp.websocket_ping_timeout = 5  # close connection if no pong within 5 s

# Use SQLiteYStore with a predictable path so conflict tests can delete
# the database during the offline period to force room recreation via
# _apply_deterministic_source_content. This simulates the production scenario
# where a room is evicted and the notebook structure changes on disk.
c.SQLiteYStore.db_path = "/tmp/jupyter_ystore_ui_test.db"

# Uncomment to set server log level to debug level
# c.ServerApp.log_level = "DEBUG"

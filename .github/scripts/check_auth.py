"""Check that all endpoints of the extension require authentication.

When unauthenticated access is not allowed, Jupyter Server warns about every
handler which is missing an authentication decorator; this script turns such a
warning into a failure, so that no endpoint can be exposed to unauthorized users
by mistake.

Run it with:

    python .github/scripts/check_auth.py
"""
import sys
import warnings

from jupyter_server.serverapp import ServerApp
from jupyter_server.utils import JupyterServerAuthWarning

# Initialize a server which only loads this extension and which does not allow
# unauthenticated access.
app = ServerApp(
    allow_unauthenticated_access=False,
    jpserver_extensions={"jupyter_server_ydoc": True},
    # Fail loudly if the extension cannot be loaded at all, instead of silently
    # reporting that there is nothing to complain about.
    reraise_server_extension_failures=True,
)

with warnings.catch_warnings(record=True) as records:
    warnings.simplefilter("always")
    app.initialize(argv=[], find_extensions=False, new_httpserver=False)

problems = [
    str(record.message)
    for record in records
    if issubclass(record.category, JupyterServerAuthWarning)
]

if problems:
    sys.exit(
        "\n".join(problems)
        + "\n\nAdd a `@tornado.web.authenticated` decorator to the verb methods listed"
        " above. If an endpoint is intended to be public, add an explicit"
        " `@allow_unauthenticated` (or `@ws_authenticated` for websockets) decorator"
        " from `jupyter_server.auth.decorator` instead."
    )

print("All endpoints of the extension require authentication.")

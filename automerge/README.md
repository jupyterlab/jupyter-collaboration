# Jupyter RTC with Automerge

This folder contains (WIP) implementation for Jupyter Real Time Collaboration with [Automerge](https://github.com/automerge/automerge) CRDT Library.

You can use the provided `Makefile` to simplify development.

```bash
# Install and build the jupyter-rtc development environment.
make install
make build
```

You are now ready to develop. For this, launch the servers.

```bash
# Start the needed servers (jupyter and node)
make start-dev
```

You can also start the servers separately.

```bash
# Start only jupyterlab.
make start-jlab
```

```bash
# Start only jupyter server.
make start-jserver
```

```bash
# Start only the textarea server.
make start-textarea
```

# Jupyter RTC with Automerge

This folder contains (WIP) implementation for Jupyter Real Time Collaboration with [Automerge](https://github.com/automerge/automerge) CRDT Library.

You can use the provided `Makefile` to simplify development.

```bash
# Install the jupyter-rtc development environment.
make install
```

You are now ready to develop. For this, launch the servers.

```bash
# Start the jupyter server on http://localhost:8888
# (with jupyterlab, jupyter-auth and jupyter-rtc)
# as a node.js server on http://localhost:4321
make start-dev
```

You can also start the servers separately.

```bash
# Start the jupyter server on http://localhost:8888
# (with jupyterlab, jupyter-auth and jupyter-rtc)
make start-jlab
```

```bash
# Start jupyter server on http://localhost:8888
make start-jserver
```

```bash
# Start only the node.js server on http://localhost:4321
# for textarea UI on http://localhost:3001
make start-textarea
```

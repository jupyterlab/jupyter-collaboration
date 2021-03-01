# Jupyter RTC with Automerge

This folder contains (WIP) implementation for Jupyter Real Time Collaboration with [Automerge](https://github.com/automerge/automerge) CRDT Library.

You can use the provided `Makefile` to simplify development.

```bash
# Install the jupyter-rtc development environment.
make install
```

You are now ready to develop. For this, launch JupyterLab in `dev` and `watch` modes.

```bash
# Start the jupyter server on http://localhost:8888
# (with jupyterlab, jupyter-auth and jupyter-rtc)
make start-jupyterlab
```

You can also start the servers separately.

```bash
# Start the jupyter server on http://localhost:8888
# (with jupyterlab, jupyter-auth and jupyter-rtc)
make start-juptyer-server
# Start jupyter server on http://localhost:8888
make start-nodejs
# Start only the node.js server on http://localhost:4321
# for textarea UI on http://localhost:3001
make start-textarea
```

## Docker

```bash
export DOCKER_REPO=<YOUR_DOCKER_REPOSITORY>
# Build the docker image (be patient...) 
make docker-build
# Start JupyterLab on http://localhost:8888
make docker-start
# Optionally, push you image.
make docker-push
```
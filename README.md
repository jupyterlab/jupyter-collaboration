# Real Time Collaboration ![.github/workflows/nodejs.yml](https://github.com/jupyterlab/rtc/workflows/.github/workflows/nodejs.yml/badge.svg)

This monorepo contains current work on Real Time collaboration for use in JupyterLab and other web applications.

It is currently in the planning stage, but eventually we see it containing a number of seperate projects like:

- `packages/rtc-relay`: Patch relay server to synchronize patches for `packages/rtc-client`.
- `packages/rtc-node`: Real time collaboration client, builds on `@lumino/datastore`.
- `packages/rtc-todo-example`: Example of simple todo app using relay server and node.
- `packages/jupyter-rtc`: Holds schema for Jupyter RTC tables that are used in server and client.
- `packages/jupyter-rtc-supernode`: Server to keep datastore in sync with jupyter server.
- `packages/jupyter-rtc-node`: Client to access Jupyter data.
- `src/jupyter_rtc_supernode_jupyter_extension`: Jupyter Server extension for running `packages/jupyter-rtc-supernode`.
- `src/rtc_relay_jupyter_extesion`: Jupyter Server Extension for `src/rtc_relay`
- `packages/jupyterlab-rtc-client`: `packages/rtc-client` that connets over `src/rtc_relay_jupyter`.

Most of the work currently is living in [a PR to JupyterLab](https://github.com/jupyterlab/jupyterlab/pull/6871) and documented on [an issue](https://github.com/jupyterlab/jupyterlab/issues/5382) there.

## Contribution

We welcome any and all contributions and ideas here! This is a big task and we will need as much help as we can get.

We have a bi-weekly meeting call. Please come and join! All are welcome to come and just listen or discuss any work related to this project. They are also recorded and available here (TODO: create youtube channel). For the time, place, and notes, see [this hackmd](https://hackmd.io/@_4xc7QhhSHKODRQn1uiulw/BkV24I3qL/edit).

## Development

First install yarn. Then you can start todo example app and the debugger:

![](./scratch/todo.gif)

```bash
yarn run build:tsc
yarn run start
```

## Background

### Comparison

Our current approach is to handle all communication on the clients. Alternatively,
here we propse having a server side datastore peer that handles keeping the models
up to date from the Jupyter server. It expose REST API endpoints to trigger
actions on the server, that are similar to the existing kernel endpoints, except
instead of returning the state they update the RTC models. They also expose many
of the kernel websocket methods as REST calls.

### Why?

- Keep models updated when clients are closed.
- Reduce complexity on the clients.
- Works with existing infrastructure, i.e. Jupyter Server; doesn't disrupt old way to interact with server (can be run side-by-side).
- Single source of truth datastore on the server.
- Similar REST API to existing Jupyter Server REST API — less work for clients to switch to RTC.

![](./scratch/diagram.png)

- [ ] `jupyterlab/jupyter-datastore` API spec
  - [x] kernelspecs
  - [x] status
  - [x] terminals
  - [x] kernels
  - [x] sessions
  - [x] contents
  - [ ] config (Maybe we dont need this?)
  - [ ] Rewrite to clone existing API more closely
  - [ ] Add REST endpoints for execution with cell ID
  - [ ] Add a table for kernel executions (for consoles)
  - [ ] Deal with `request_input`, either in websockets or CRDT.
  - [ ] Spec out websockets for comms
  - [ ] Add config for refresh
- [ ] Research alternative communication layers
  - [ ] https://resgate.io/
  - [ ] https://www.cncf.io/blog/2018/10/24/grpc-web-is-going-ga/
  - [ ] https://wamp-proto.org/
- [ ] `jupyterlab/lumino-datastore` API spec
  - [ ] Create API spec based on Vidar's work
- [ ] Look into ORM on top of tables, using Ian's work
- [ ] Think about undo/redo behavior!
- [ ] Think about users and permissioning!

### `jupyterlab/lumino-datastore`

Includes client and server side components for synchronized CRDTs in the browser.

### `jupyterlab/jupyter-datastore`

The Jupyter Datastore package gives you an up to date data model of the Jupyter Server data structures in your browser. It also provides an interface to take actions on the Jupyter Server.

It is meant to be a building block for any Jupyter web UIs.

Goals:

- Save notebook outputs even when client is closed
- Add undo/redo
- Sync models between browser windows

RTC models in [`./spec.ts`](./spec.ts)

API spec in [`main.py`](./main.py), translated to OpenAPI spec in [`spec.json`](./spec.json) which will be implemented in Node.

Resources:

- https://jupyter-client.readthedocs.io/en/stable/messaging.html
- http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#/contents/post_api_contents__path_
- https://github.com/jupyter/jupyter/wiki/Jupyter-Notebook-Server-API

Generating spec:

```bash
python main.py > spec.json
```

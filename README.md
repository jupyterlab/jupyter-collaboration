# Real Time Collaboration ![.github/workflows/nodejs.yml](https://github.com/jupyterlab/rtc/workflows/.github/workflows/nodejs.yml/badge.svg)

This monorepo contains current work on Real Time collaboration for use in JupyterLab and other web applications.

It is currently in the planning stage, but eventually we see it containing a number of separate projects like:

- `packages/rtc-relay`: Patch relay server to synchronize patches for `packages/rtc-client`.
- `packages/rtc-node`: Real time collaboration client, builds on `@lumino/datastore`.
- `packages/rtc-todo-example`: Example of simple todo app using relay server and node.
- `packages/jupyter-rtc`: Holds schema for Jupyter RTC tables that are used in server and client.
- `packages/jupyter-rtc-supernode`: Server to keep datastore in sync with jupyter server.
- `packages/jupyter-rtc-node`: Client to access Jupyter data.
- `src/jupyter_rtc_supernode_jupyter_extension`: Jupyter Server extension for running `packages/jupyter-rtc-supernode`.
- `src/rtc_relay_jupyter_extesion`: Jupyter Server Extension for `src/rtc_relay`
- `packages/jupyterlab-rtc-client`: `packages/rtc-client` that connects over `src/rtc_relay_jupyter`.

Most of the work currently is living in [a PR to JupyterLab](https://github.com/jupyterlab/jupyterlab/pull/6871) and documented on [an issue](https://github.com/jupyterlab/jupyterlab/issues/5382) there.

## Contribution

We welcome any and all contributions and ideas here! This is a big task and we will need as much help as we can get.

We have a bi-weekly meeting call. Please come and join! All are welcome to come and just listen or discuss any work related to this project. They are also recorded and available here (TODO: create youtube channel). For the time, place, and notes, see [this hackmd](https://hackmd.io/@_4xc7QhhSHKODRQn1uiulw/BkV24I3qL/edit).

## Development

First install Yarn and Node v14. Then you can start todo example app and the debugger:

![](./scratch/todo.gif)

```bash
yarn run build:tsc
yarn run todo:start-all
```

To try the Jupyter app:

```bash
pip install jupyterlab
yarn run build:tsc
yarn run jupyter:start-all
```

## [Design](./DESIGN.md)

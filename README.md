# Real Time Collaboration ![.github/workflows/nodejs.yml](https://github.com/jupyterlab/rtc/workflows/.github/workflows/nodejs.yml/badge.svg)

This **Real Time Collaboration** monorepo contains current work on Real Time
collaboration for use in JupyterLab and other web applications.

## About the RTC project

### Planning and direction

It is currently in the planning stage, but eventually we see the repo containing
a number of separate projects like:

- `packages/rtc-relay`: Patch relay server to synchronize patches for `packages/rtc-client`.
- `packages/rtc-node`: Real time collaboration client, builds on `@lumino/datastore`.
- `packages/rtc-todo-example`: Example of simple todo app using relay server and node.
- `packages/jupyter-rtc`: Holds schema for Jupyter RTC tables that are used in server and client.
- `packages/jupyter-rtc-supernode`: Server to keep datastore in sync with jupyter server.
- `packages/jupyter-rtc-node`: Client to access Jupyter data.
- `src/jupyter_rtc_supernode_jupyter_extension`: Jupyter Server extension for running `packages/jupyter-rtc-supernode`.
- `src/rtc_relay_jupyter_extesion`: Jupyter Server Extension for `src/rtc_relay`
- `packages/jupyterlab-rtc-client`: `packages/rtc-client` that connects over `src/rtc_relay_jupyter`.

### Current work on JupyterLab

Most of the work currently is living in [a PR to JupyterLab](https://github.com/jupyterlab/jupyterlab/pull/6871) and documented on [an issue](https://github.com/jupyterlab/jupyterlab/issues/5382) there.

### Living specification

We are working on creating a living specification for the protocol(s) created
here, in the [`SPEC.md`](./SPEC.md) file. We're doing our best but it may not
always be totally in sync with explorations in the repo, until they are settled
on.

### [Design](./DESIGN.md)

## Contribute

We welcome any and all contributions and ideas here! This is a big task and we
will need as much help as we can get. The [`CONTRIBUTING.md`](./CONTRIBUTING.md)
file contains more specific information.

### Project meeting schedule

We have a bi-weekly meeting call. Please come and join! All are welcome to come
and just listen or discuss any work related to this project. They are also
recorded and available here (TODO: create youtube channel). For the time, place,
and notes, see [this hackmd](https://hackmd.io/@_4xc7QhhSHKODRQn1uiulw/BkV24I3qL/edit).

We also use hackmd to set an agenda and to capture notes for these meetings.

### Learning pathway

We are striving to keep meetings productive and on topic. If you are joining
us for the first time or need a refresher about the project's scope, we
recommend reading the following documents:

- this `README.md`
- living specification [`SPEC.md`](./SPEC.md)
- design document [Design](./DESIGN.md)
- current vision in grant proposal for CZI [`CZI-2020-proposal.md`](./funding/CZI-2020-proposal.md)

## Development

### Installation

First install Yarn and Node v14. Using conda, enter:

```bash
conda create -n rtc -c conda-forge jupyterlab nodejs=14 yarn
conda activate rtc
```

### Usage

Then you can start todo example app and the
debugger:

![](./scratch/todo.gif)

```bash
yarn
yarn run build:tsc
yarn run todo:start-all
```

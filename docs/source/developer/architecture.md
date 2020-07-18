# Architecture

*Document under development*

We have today the following packages available:

- `packages/rtc-relay`: Patch relay server to synchronize patches for `packages/rtc-node`.
- `packages/rtc-node`: Real time collaboration client, builds on `@lumino/datastore`.
- `packages/rtc-jupyter`: Holds schema for Jupyter RTC tables that are used in server and client.
- `packages/rtc-jupyter-supernode`: Server to keep datastore in sync with jupyter server.

You can use those packages with examples:

- `packages/rtc-todo-example`: Example of simple todo app using relay server and node.
- `packages/rtc-jupyter-example`: Client to access Jupyter data.

It is currently in the planning stage, but eventually we see the repo containing
a number of additional separate projects like:

- `src/jupyter_rtc_supernode_jupyter_extension`: Jupyter Server extension for running `packages/jupyter-rtc-supernode`.
- `src/rtc_relay_jupyter_extension`: Jupyter Server Extension for `src/rtc_relay`
- `packages/jupyterlab-rtc-client`: `packages/rtc-client` that connects over `src/rtc_relay_jupyter`.

## Packages Architecture

![The development architecture](images/dev-architecture.svg "The development architecture")

## Redux

We may need to introduce a global state management `a-la-redux`. See the following repositories for inspiration.

- <https://github.com/devresults/cevitxe>
- <https://github.com/redux-orm/redux-orm>

# Architecture

## Packages

We have today the following packages available:

- `packages/relay`: Patch relay server to synchronize patches for `packages/node`.
- `packages/node`: Real time collaboration client, builds on `@lumino/datastore`.
- `packages/jupyter`: Holds schema for Jupyter RTC tables that are used in server and client.
- `packages/supernode`: Server to keep datastore in sync with jupyter server.

You can use those packages with examples:

- `examples/jupyter`: Client to access Jupyter Server data.
- `examples/lumino`: Example of Lumino Datastore app.
- `examples/todo`: Example of simple todo app using relay server and node.

We also provide useful tooling packages to accompany the main packages.

- `tools/debugger`
- `tools/dummy-store`

![The development architecture](images/dev-architecture.svg "The development architecture")

## Jupyter Extensions

It is currently in the planning stage, but eventually we see this repo containing a number of jupyter extensions like:

- `src/rtc_supernode_jupyter_extension`: Jupyter Server extension for running `packages/supernode`.
- `src/rtc_relay_jupyter_extension`: Jupyter Server Extension for `packages/relay`
- `packages/jupyterlab-rtc-client`: `packages/client` that connects over `src/rtc_relay_jupyter_extension`.

## Distributed State

We may need to introduce a global distributed state management `a-la-redux`. See the following repositories for inspiration:

- <https://github.com/devresults/cevitxe>
- <https://github.com/redux-orm/redux-orm>
- <https://github.com/logux/redux>

# Architecture

## Packages

We have today the following main packages available:

- [@jupyter-rtc/relay](https://github.com/jupyterlab/rtc/tree/main/packages/relay): Patch relay server to synchronize patches for `@jupyter-rtc/node`.
- [@jupyter-rtc/node](https://github.com/jupyterlab/rtc/tree/main/packages/node): Real time collaboration client, builds on `@lumino/datastore`.
- [@jupyter-rtc/jupyter](https://github.com/jupyterlab/rtc/tree/main/packages/jupyter): Holds schema for Jupyter RTC tables that are used in server and client.
- [@jupyter-rtc/supernode](https://github.com/jupyterlab/rtc/tree/main/packages/supernode): Server to keep datastore in sync with jupyter server.

You can use those packages with examples:

- [@jupyter-rtc/jupyter-example](https://github.com/jupyterlab/rtc/tree/main/examples/jupyter): Client to access Jupyter Server data (notebook content, kernel...).
- [@jupyter-rtc/lumino-example](https://github.com/jupyterlab/rtc/tree/main/examples/lumino): Example of a standalone Lumino Datastore application.
- [@jupyter-rtc/todo-example](https://github.com/jupyterlab/rtc/tree/main/examples/todo): Example of simple To Do application using `@jupyter-rtc/relat` server.

We also provide useful tooling packages to accompany the main packages.

- [@jupyter-rtc/debugger](https://github.com/jupyterlab/rtc/tree/main/tools/debugger)
- [@jupyter-rtc /dummy-store](https://github.com/jupyterlab/rtc/tree/main/tools/dummy-store)

![The development architecture](images/dev-architecture.svg "The development architecture")

## Jupyter Extensions

It is currently in the planning stage, but eventually we see the [jupyterlab/rtc](https://github.com/jupyterlab/rtc) repository containing a number of other server extensions and client packages like:

- `supernode_jupyter_extension`: Jupyter Server extension for running `@jupyter-rtc/supernode`.
- `relay_jupyter_extension`: Jupyter Server Extension for` @jupyter-rtc/relay`
- `jupyterlab-rtc-client`: A client that connects over `rtc_relay_jupyter_extension`.

## Distributed State

We may need to introduce a global distributed state management `a-la-redux`. See the following repositories for inspiration:

- [cevitxe](https://github.com/devresults/cevitxe)
- [redux-orm](https://github.com/redux-orm/redux-orm)
- [logux/redux](https://github.com/logux/redux)

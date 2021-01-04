# Architecture

## Packages

We have today the following main packages available:

- [@jupyter-rtc/relay](https://github.com/jupyterlab/rtc/tree/main/lumino/packages/relay): Patch relay server to synchronize patches for `@jupyter-rtc/node`.
- [@jupyter-rtc/node](https://github.com/jupyterlab/rtc/tree/main/lumino/packages/node): Real time collaboration client, builds on `@lumino/datastore`.
- [@jupyter-rtc/jupyter](https://github.com/jupyterlab/rtc/tree/main/lumino/packages/jupyter): Holds schema for Jupyter RTC tables that are used in server and client.
- [@jupyter-rtc/supernode](https://github.com/jupyterlab/rtc/tree/main/lumino/packages/supernode): Server to keep datastore in sync with jupyter server.

You can use those packages with examples:

- [@jupyter-rtc/jupyter-example](https://github.com/jupyterlab/rtc/tree/main/lumino/examples/jupyter): Client to access Jupyter Server data (notebook content, kernel...).
- [@jupyter-rtc/lumino-example](https://github.com/jupyterlab/rtc/tree/main/lumino/examples/lumino): Example of a standalone Lumino Datastore application.
- [@jupyter-rtc/todo-example](https://github.com/jupyterlab/rtc/tree/main/lumino/examples/todo): Example of simple To Do application using `@jupyter-rtc/relat` server.

We also provide useful tooling packages to accompany the main packages.

- [@jupyter-rtc/debugger](https://github.com/jupyterlab/rtc/tree/main/lumino/tools/debugger)
- [@jupyter-rtc /dummy-store](https://github.com/jupyterlab/rtc/tree/main/lumino/tools/dummy-store)

![The development architecture](images/dev-architecture.svg "The development architecture")

## Other Protential Packages

Is it useful or needed to introduce a global distributed state management `a-la-redux`? See the following repositories for inspiration:

- [cevitxe](https://github.com/devresults/cevitxe)
- [redux-orm](https://github.com/redux-orm/redux-orm)
- [logux/redux](https://github.com/logux/redux)

Eventually we see the [jupyterlab/rtc](https://github.com/jupyterlab/rtc) repository containing a number of other server extensions and client packages like:

- `supernode_jupyter_extension`: Jupyter Server extension for running `@jupyter-rtc/supernode`.
- `relay_jupyter_extension`: Jupyter Server Extension for` @jupyter-rtc/relay`
- `jupyterlab-rtc-client`: A client that connects over `rtc_relay_jupyter_extension`.

## Actors

We define the following human and technical actors of the system:

- User: The human user of the JupyterClient.
- Jupyter_Frontend: The end-user application, e.g. JupyterLab.
- Jupyter_Rest: The existing Jupyter server REST endpoints (load/save notebooks...).
- Jupyter_WS: The existing Jupyter server Kernel Websocket that allows running code cells code.
- RTC_Client: The client library provided by jupyter-rtc for realtime update communications.
- RTC_Server: The server library provided by jupyter-rtc for realtime update communications.
- GQL_Client: The client library to interact withh the GQL-Server.
- GQL_Server: The server side GraphQL compliant service.

## Use Cases

### CRUD Notebook

Create, Read, Update or Delete (CRUD) a Notebook.

```{eval-rst}
.. mermaid::

   sequenceDiagram
      participant User
      participant Jupyter_Frontend
      participant RTC_Client
      participant RTC_Server
      participant Jupyter_Rest
      User-->Jupyter_Frontend: Request CRUD Notebook
      Jupyter_Frontend-->RTC_Client: Request CRUD Notebook
      RTC_Client-->RTC_Server: Request CRUD Notebook
      RTC_Server-->Jupyter_Rest: Request CRUD Notebook
      Jupyter_Rest-->RTC_Server: Response CRUD Notebook
      RTC_Server-->RTC_Client: Response CRUD Notebook
      RTC_Client-->Jupyter_Frontend: Response CRUD Notebook
      Jupyter_Frontend-->User: Response CRUD Notebook
```

### Run a Cell

```{eval-rst}
.. mermaid::

   sequenceDiagram
      participant User
      participant Jupyter_Frontend
      participant RTC_Client
      participant RTC_Server
      participant Jupyter_WS
      User-->Jupyter_Frontend: Request Code Execution
      Jupyter_Frontend-->RTC_Client: Request Code Execution
      RTC_Client-->RTC_Server: Request Code Execution
      RTC_Server-->Jupyter_WS: Request Code Execution
      Jupyter_WS-->RTC_Server: Response Code Execution
      RTC_Server-->RTC_Client: Response Code Execution
      RTC_Client-->Jupyter_Frontend: Response Code Execution
      Jupyter_Frontend-->User: Response Code Execution
```

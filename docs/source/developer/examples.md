# Examples

The examples reside in the [examples folder](https://github.com/jupyterlab/rtc/tree/main/examples)

To build and try them all, you first need to install Yarn, Node.js and JupyterLab.

```bash
# Using conda, enter the following commands.
conda create -n rtc -c conda-forge jupyterlab nodejs=14 yarn
conda activate rtc
```

```bash
# Build the source.
yarn
yarn build:tsc
```

## Lumino Datastore Example

This [simple lumino datastore example](https://github.com/jupyterlab/rtc/tree/main/examples/lumino-datastore) is useful to demonstrate and understand the basics of the [Lumino Datastore](https://github.com/jupyterlab/lumino/tree/master/packages/datastore) system.

```bash
# Build and start the server
yarn && \
  yarn && \
  yarn build && \
  yarn start
```

Open in browser 1 (e.g. Chrome) http://localhost:8000.

Then open that same link http://localhost:8000 in browser 2 (e.g. Firefox).

Every character you input in one of the 2 browsers should be reflected in realtime in the other browser.

PS: The content of this example has been taken from the [Lumino example-datastore folder](https://github.com/jupyterlab/lumino/tree/master/examples/example-datastore).

## Todo Example

You can start [todo example app](https://github.com/jupyterlab/rtc/tree/main/examples/rtc-todo-example) and the [debugger](https://github.com/jupyterlab/rtc/tree/main/tools/rtc-debugger).

```bash
yarn todo:start-all
```

![RTC ToDo Example](images/todo.gif "RTC ToDo Example")

## Jupyter Example

You can also start the [Jupyter example](https://github.com/jupyterlab/rtc/tree/main/examples/rtc-jupyter-example).

```bash
yarn jupyter:start-all
```

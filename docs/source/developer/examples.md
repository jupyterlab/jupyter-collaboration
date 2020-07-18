# Examples

First install Yarn and Node v14. Using conda, enter:

```
conda create -n rtc -c conda-forge jupyterlab nodejs=14 yarn
conda activate rtc
```

Build the source.

```bash
yarn
yarn build:tsc
```

Then you can start todo example app and the debugger.

```bash
yarn todo:start-all
```

![To Do Example](images/todo.gif "To Do Example")

You can also start the Jupyter example.

```bash
pip install jupyterlab
yarn jupyter:start-all
```

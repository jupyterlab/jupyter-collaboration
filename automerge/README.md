# Jupyter RTC with Automerge

This folder contains (WIP) implementation for Jupyter Real Time Collaboration with [Automerge](https://github.com/automerge/automerge) CRDT Library.

```bash
conda env create -f environment.yml && \
  conda activate jupyter-rtc
cd rust && \
  make all && \
  pip list | grep glootalk && \
  cd ./../externals
git clone https://github.com/datalayer-contrib/automerge automerge-wasm-bundler && \
  cd automerge-wasm-bundler && \
  git checkout wasm-bundler && \
  cd ./..
git clone https://github.com/datalayer-contrib/automerge automerge-wasm-nodejs && \
  cd automerge-wasm-nodejs && \
  git checkout wasm-nodejs && \
  cd ./../..
yarn && \
  yarn build
pip install -e .
```

```bash
# Build JupyterLab Extension.
conda activate jupyter-rtc
cd packages/jupyterlab-rtc
jupyter labextension develop --overwrite
jupyter labextension list
```

```bash
# Start JupyterLab, Node.js Server and TextArea UI.
conda activate jupyter-rtc
yarn dev
open http://localhost:8888/lab
open http://localhost:3001
open http://localhost:4321
```

```bash
# Start JupyterLab.
conda activate jupyter-rtc
jupyter lab \
  --watch \
  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
  --ServerApp.allow_origin="*" \
  --ServerApp.token=
open http://localhost:8888/lab
open http://localhost:8888/jupyter_rtc/default
```

```bash
# If you don't need JupyterLab, start Jupyter Server.
conda activate jupyter-rtc
jupyter server \
  --ServerApp.jpserver_extensions="{'jupyter_rtc': True}" \
  --ServerApp.allow_origin="*"
```

```bash
# Start the TextArea application.
conda activate jupyter-rtc
yarn textarea:start
open http://localhost:3001
```

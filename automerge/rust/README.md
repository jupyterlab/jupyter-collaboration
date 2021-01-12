# glootalk-python 

This repository contains the source code for the glootalk python module. The module is written in rust, and PyO3 is used
to create a Python rust-extension.

## Environment Setup

#### conda environment

The conda environment contains all the required packages to build the glootalk extension. 

`conda env create -f environment.yaml` will install the `glooktalk` environment.

Activate the `glootalk` environment, which will allow you to build _and_ seperately _install_ the packages.

## Build

Building the package requires using the `makefile`. `make build` Will build the rust extenion into a python module, located in the target folder. You can import the binary after renaming it to `glootalk.so`. Since an install will automatically build, Installing is reccommended unless debugging.

## Install

Simply do a `python setup.py install`. Before starting an interpreter, _ensure_ that you have `cd` out of the root directory.

## Usage

```python
import glootalk
glootalk.start_server(port=4321, log_path=".")

```


`glootalk` contains the start_server method, which will start a server at `127.0.0.1:{port}` and will write a file `gt_ws.log` to the defined filepath at log_fs_path. 

## Testing

To test a websocket server, open a console in your browser. In the console:
```
var sock = new WebSocket("127.0.0.1:9042")
sock.send("Hello!")
```

The log file shuld contain a log of messages sent to the server

## Using Automerge API

```python
glootalk.automerge.init(log_path=".")
```

This simply initializes the automerge backend.

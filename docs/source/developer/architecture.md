# Code Architecture

## Current implementation

COMING SOON...

### Class diagram
![classes](../images/class_diagram.svg)

### Opening a document
![initialization](../images/initialization_diagram.svg)

### Reconnecting
The websocket connection might close for multiple reasons. In this section you will find a diagram explaining the process of reconnecting
to an old collaborative session.

![reconnect](../images/reconnect_diagram.svg)

### Autosave
![autosave](../images/autosave_diagram.svg)

### Conflict
![conflict](../images/conflict_diagram.svg)

## Early attempts

Prior to the current implementation based on [Yjs](https://docs.yjs.dev/), other attempts using
different technologies where tried:

- Attempt based on [Automerge](https://automerge.org/). The code has been archived in that [branch](https://github.com/jupyterlab/jupyter_collaboration/tree/automerge). You can
  access the [documentation there](https://jupyterlab-realtime-collaboration.readthedocs.io/en/automerge/).

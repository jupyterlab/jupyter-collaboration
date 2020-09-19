# Libraries

Before jumping to a specific `RTC Library`, you may be interested in more general context and comparison.

## Lumino

CRDT Implementation by JupyterLab.

- <https://github.com/jupyterlab/lumino/tree/master/packages/datastore>

Used by.

- [interactive-dashboard-editor](https://github.com/jupytercalpoly/jupyterlab-interactive-dashboard-editor)

## Y.js

CRDT Implementation.

- <https://github.com/yjs/yjs>
- <https://github.com/dmonad/lib0/blob/master/encoding.js#L1>
- <https://github.com/dmonad/lib0>

Y.js Demos

- <https://github.com/yjs/yjs-demos>
- <https://yjs.dev>
- <https://yjs.dev/#demos>
- <https://demos.yjs.dev>
- <https://demos.yjs.dev/monaco/monaco.html>

- <https://discuss.yjs.dev>

- <https://publishpress.com/blog/yjs>
- <https://www.tag1consulting.com/blog/deep-dive-real-time-collaborative-editing-solutions-tagteamtalk-001-0>

## Automerge

A JSON-like data structure (a CRDT) that can be modified concurrently by different users, and merged again automatically.

- <https://github.com/automerge/automerge>
- <https://github.com/automerge/automerge/pull/253>

Collaborative editing to CodeMirror by linking it to an Automerge.Text object

- <https://github.com/aslakhellesoy/automerge-codemirror>

Rust implementation

- <https://github.com/automerge/automerge-rs>

Persistence

- <https://github.com/automerge/mpl>
- <https://github.com/automerge/hypermerge>

Examples

- <https://github.com/automerge/pushpin>
- <https://automerge.github.io/pushpin>
- <https://github.com/automerge/pixelpusher>
- DEPRECATED <https://github.com/automerge/trellis>

## Teletype

String-wise sequence CRDT powering peer-to-peer collaborative editing in Teletype for Atom.

- <https://github.com/atom/teletype-crdt>

## Local First

A nested object CRDT, a hybrid logical clock with a rich-text CRDT.

- <https://github.com/jaredly/local-first>
- <https://jaredforsyth.com>

## CRDT by @phedkvist

- <https://github.com/phedkvist/crdt-sequence>
- <https://github.com/phedkvist/crdt-server>

## Logux

Logux has features inspired by CRDT to resolve edit conflicts between users. Real-time updates to prevent conflicts. Time travel to keep actions order the same on every client. A distributed timer to detect the latest changes.

- <https://logux.io>
- <https://github.com/logux/server>
- <https://github.com/logux/client>

## Rust CRDT

- <https://github.com/rust-crdt/rust-crdt>

## ShareDB

ShareDB is a realtime database backend based on Operational Transformation (OT) of JSON documents. It is the realtime backend for the DerbyJS web application framework.

- <https://github.com/share/sharedb>
- <https://github.com/startupjs/startupjs>
- <https://github.com/startupjs/startupjs/tree/master/packages/react-sharedb>

Deprecated

- <https://github.com/dmapper/react-sharedb>
- <https://github.com/josephg/ShareJS>
- <https://sharejs.org>

## OT.js

OT.js is not maintained anymore.

- <https://github.com/Operational-Transformation/ot.js>

## Google Diff-Match-Patch

- <https://github.com/google/diff-match-patch>

## Diff-Sync by @janmonschke

- <https://github.com/janmonschke/diffsync>
- <https://github.com/janmonschke/diffsync-todos>
- <https://diffsync-todos.herokuapp.com>

## Microsoft Fluid

Microsoft Fluid has been announced.

- <https://techcommunity.microsoft.com/t5/microsoft-365-blog/introducing-the-first-microsoft-fluid-framework-experiences-in/ba-p/1345543>
- <https://support.microsoft.com/en-us/office/get-started-with-fluid-framework-preview-d05278db-b82b-4d1f-8523-cf0c9c2fb2df>

It is released.

- <https://github.com/microsoft/FluidFramework>
- <https://fluidframework.com/>

TODO Look if this can be used outside of [Microsoft Office 365](https://www.office.com).

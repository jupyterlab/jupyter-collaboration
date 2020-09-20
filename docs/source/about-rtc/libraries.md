# Libraries

## Lumino

[JupyterLab RTC integration](/developer/integrations) is relying on the CRDT Implementation provided by [Lumino Datastore](https://github.com/jupyterlab/lumino/tree/master/packages/datastore). The Lumino Datastore library is also used in e.g. the [interactive dashboard editor](https://github.com/jupytercalpoly/jupyterlab-interactive-dashboard-editor) for JupyterLab.

## Y.js

[Y.js](https://github.com/yjs/yjs) is a CRDT implementation with lot of Demos.

- <https://github.com/yjs/yjs-demos>
- <https://yjs.dev>
- <https://demos.yjs.dev>
- <https://demos.yjs.dev/monaco/monaco.html>

Read more on the [discussions site](https://discuss.yjs.dev) and the [blog](https://publishpress.com/blog/yjs) (backed by [tag1consulting](https://www.tag1consulting.com/blog/deep-dive-real-time-collaborative-editing-solutions-tagteamtalk-001-0_)). See also.

- <https://github.com/dmonad/lib0/blob/master/encoding.js#L1>
- <https://github.com/dmonad/lib0>

## Automerge

[Automerge](https://github.com/automerge/automerge) is a JSON-like data structure (a CRDT) that can be modified concurrently by different users, and merged again automatically.

- [Performance Preview: Automerge binary data format](https://github.com/automerge/automerge/pull/253).
- [Collaborative editing to CodeMirror](https://github.com/aslakhellesoy/automerge-codemirror) by linking it to an `Automerge.Text` object
- [Automerge-rs](https://github.com/automerge/automerge-rs) is a Rust implementation.
- Persistence with [mpl](https://github.com/automerge/mpl) or [hypermerge](https://github.com/automerge/hypermerge).

Applications examples can be found.

- <https://github.com/automerge/pushpin>
- <https://automerge.github.io/pushpin>
- <https://github.com/automerge/pixelpusher>
- [DEPRECATED] <https://github.com/automerge/trellis>

## Microsoft Fluid

[Microsoft Fluid](https://fluidframework.com) has been announced in [May 2020](https://techcommunity.microsoft.com/t5/microsoft-365-blog/introducing-the-first-microsoft-fluid-framework-experiences-in/ba-p/1345543) ([see also this doc](https://support.microsoft.com/en-us/office/get-started-with-fluid-framework-preview-d05278db-b82b-4d1f-8523-cf0c9c2fb2df)). It is now [released](https://github.com/microsoft/fluidframework).

The offered functionalities and how it can be used outside of [Microsoft Office 365](https://www.office.com) are investigated in [jupyterlab/rtc#80](https://github.com/jupyterlab/rtc/issues/80).

- [Introducing distributed data structures](https://fluidframework.com/docs/concepts/dds).
- On Hacker News: [Fluid framework, for building distributed, real-time collaborative web apps](https://news.ycombinator.com/item?id=24417482) - You can read there: *Adding more context: Fluid uses a mix of CRDT + OT to maintain state across multiple clients. I wrote a quick high level explanation of how Fluid uses eventual consistency and why it matters for real time collaboration* ([more details](https://matt.aimonetti.net/posts/2020-09-solving-real-time-collaboration-using-eventual-consistency))

## Teletype

[Teletype CRDT](https://github.com/atom/teletype-crdt) is string-wise sequence CRDT powering peer-to-peer collaborative editing in Teletype for Atom.

## Local First

[Local First](https://github.com/jaredly/local-first) (by [jaredforsyth](https://jaredforsyth.com)) is nested object CRDT, a hybrid logical clock with a rich-text CRDT.

## CRDT-sequence

[CRDT-sequence](https://github.com/phedkvist/crdt-sequence) (by @phedkvist), with a [server](https://github.com/phedkvist/crdt-server).

## Logux

[Logux](https://logux.io) has features inspired by CRDT to resolve edit conflicts between users. Real-time updates to prevent conflicts. Time travel to keep actions order the same on every client. A distributed timer to detect the latest changes. It provides a [Server](https://github.com/logux/server) and a [client](https://github.com/logux/client).

## Rust CRDT

[Rust CRDT](https://github.com/rust-crdt/rust-crdt) is a family of CRDT's supporting both State and Op based replication..

## ShareDB

[ShareDB](https://github.com/share/sharedb) is a realtime database backend based on Operational Transformation (OT) of JSON documents. It is the realtime backend for the DerbyJS web application framework.

- <https://github.com/startupjs/startupjs>
- <https://github.com/startupjs/startupjs/tree/master/packages/react-sharedb>
- [DEPRECATED] <https://github.com/dmapper/react-sharedb>
- [DEPRECATED] <https://github.com/josephg/ShareJS>
- [DEPRECATED] <https://sharejs.org>

## OT.js

[OT.js](https://github.com/Operational-Transformation/ot.js) is not maintained anymore.

## Google Diff-Match-Patch

[Google Diff-Match-Patch](https://github.com/google/diff-match-patch) offers robust algorithms to perform the operations required for synchronizing plain text.

## Diff-Sync

[Diff-Sync](https://github.com/janmonschke/diffsync) library (by @janmonschke). See the [diffsync-todos example](https://github.com/janmonschke/diffsync-todos) deployed on [heroku](https://diffsync-todos.herokuapp.com).

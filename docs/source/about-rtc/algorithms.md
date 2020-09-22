# Algorithms

We can class the `RTC Algorithms` into 3 main categories:

1. [CRDT](#crdt) category doesn't need a central server and is used by Riak, TomTom GPS, Teletype for Atom...
2. [OT](#ot) category needs a central server and is used by Google Docs, Office365...
3. [Diffs](#diffs) category used by [Cocalc](https://blog.cocalc.com/2018/10/11/collaborative-editing.html)...

Some implementations have a [Mixed](#mixed) approach combining techniques of the above categories.

We also have an [Others](#others) section for algorithm that don't fit into those categories.

The following brings more perspective on the category positions.

- [To OT or CRDT, that is the question](https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt) and its references
- [Collaborative Editing in CoCalc: OT, CRDT, or something else?](https://blog.cocalc.com/2018/10/11/collaborative-editing.html)
- [Towards a unified theory of Operational Transformation and CRDT](https://medium.com/@raphlinus/towards-a-unified-theory-of-operational-transformation-and-crdt-70485876f72f)
- [Differences between OT and CRDT](https://stackoverflow.com/questions/26694359/differences-between-ot-and-crdt)
- [Operational Transformation library?](https://stackoverflow.com/questions/2043165/operational-transformation-library)
- [Real Differences Between OT and CRDT for Co-Editors](https://news.ycombinator.com/item?id=18191867)
- [Fluid framework, for building distributed, real-time collaborative web apps](https://news.ycombinator.com/item?id=24417482) - You can read there: *Adding more context: Fluid uses a mix of CRDT + OT to maintain state across multiple clients. I wrote a quick high level explanation of how Fluid uses eventual consistency and why it matters for real time collaboration* ([more details](https://matt.aimonetti.net/posts/2020-09-solving-real-time-collaboration-using-eventual-consistency))
- [Conclave - A private and secure real-time collaborative text editor](https://conclave-team.github.io/conclave-site)

## CRDT

### About CRDT

CRTD is an ancronym for `Conflict-free Replicated Data Type`. CRDT doesn't need a central server and is used by Riak, TomTom GPS, Teletype for Atom. CRDT is about `Shared Data Structures`.

- [CRDT on Wikipedia](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type)
- [Y.js README](https://github.com/yjs/yjs/blob/main/README.md)
- [CRDT.tech](https://crdt.tech)
- [Creating a Collaborative Editor](https://pierrehedkvist.com/posts/1-creating-a-collaborative-editor)
- [A simple approach to building a realtime collaborative text editor](https://digitalfreepen.com/2017/10/06/simple-real-time-collaborative-text-editor.html)

The following videos are useful to discover CRTD in relationship with OT.

- [Conflict Resolution for Eventual Consistency](https://www.youtube.com/watch?v=yCcWpzY8dIA)
- [CRDTs and the Quest for Distributed Consistency](https://www.youtube.com/watch?v=B5NULPSiOGw)
- [CRDTs for Non Academics](https://www.youtube.com/watch?v=vBU70EjwGfw)

CRDT is strongly eventual consistent:

- <https://medium.com/@amberovsky/crdt-conflict-free-replicated-data-types-b4bfc8459d26>
- <https://medium.com/@naveennegi/rendezvous-with-riak-crdts-part-1-e94cfc8fe091>
- <https://medium.com/@dmitrymartyanov/crdt-for-data-consistency-in-distributed-environment-ddb8dfdbc396>

CRDT can use [Version Vectors](https://en.wikipedia.org/wiki/Version_vector) to assign versions that indicate how many changes have been made by a user.

You can also jump into the following links to get more details.

- <https://www.youtube.com/watch?v=jIR0Ngov7vo>
- <https://arxiv.org/abs/1608.03960>
- <https://dl.acm.org/doi/10.1145/3359141>
- <https://github.com/yjs/yjs#Yjs-CRDT-Algorithm>
- <https://www.researchgate.net/publication/310212186_Near_Real-Time_Peer-to-Peer_Shared_Editing_on_Extensible_Data_Types>
- <https://www.serverless.com/blog/crdt-explained-supercharge-serverless-at-edge>
- <https://www.infoq.com/presentations/crdt-production>
- <https://www.infoworld.com/article/3305321/when-to-use-a-crdt-based-database.html>
- <https://www.figma.com/blog/how-figmas-multiplayer-technology-works>
- <https://github.com/alangibson/awesome-crdt>

CRDT has some edge cases: [The Hard Parts](https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html) and its references ([slides](https://speakerdeck.com/ept/crdts-the-hard-parts) - [1h10m video](https://www.youtube.com/watch?v=x7drE24geUw) - [hacker news discussion](https://news.ycombinator.com/item?id=23802208)).

[RGA Split](https://pages.lip6.fr/Marc.Shapiro/papers/rgasplit-group2016-11.pdf) is a High Responsiveness for Group Editing CRDTs.

Some post-mortem stories can be instructive: [xi-editor link 1](https://github.com/xi-editor/xi-editor/issues/1187#issuecomment-491473599) and [xi-editor link 2](https://news.ycombinator.com/item?id=19886883).

Other information:

- [CRDT is used in Apache Cassandra](https://cassandra.apache.org/doc/latest/architecture/dynamo.html#dataset-partitioning-consistent-hashing).
- [Are CRDTs suitable for shared editing?](https://news.ycombinator.com/item?id=24176455)

### CRDT Libraries

[JupyterLab RTC integration](/developer/integrations.html#jupyterlab) is relying on the CRDT Implementation provided by [Lumino Datastore](https://github.com/jupyterlab/lumino/tree/master/packages/datastore). The Lumino Datastore library is also used in e.g. the [interactive dashboard editor](https://github.com/jupytercalpoly/jupyterlab-interactive-dashboard-editor) for JupyterLab.

[Y.js](https://github.com/yjs/yjs) is a CRDT implementation with online demos.

- <https://yjs.dev>
- <https://demos.yjs.dev>
- <https://github.com/yjs/yjs-demos>

Read more on the [Y.js discussion site](https://discuss.yjs.dev) and the [Y.js blog](https://publishpress.com/blog/yjs) (backed by [tag1consulting](https://www.tag1consulting.com/blog/deep-dive-real-time-collaborative-editing-solutions-tagteamtalk-001-0_)) and [lib0 encoding](https://github.com/dmonad/lib0/blob/master/encoding.js#L1) ([lib0 repo](https://github.com/dmonad/lib0)).

[Automerge](https://github.com/automerge/automerge) is a JSON-like data structure (a CRDT) that can be modified concurrently by different users, and merged again automatically.

- [Performance Preview: Automerge binary data format](https://github.com/automerge/automerge/pull/253).
- [Collaborative editing to CodeMirror](https://github.com/aslakhellesoy/automerge-codemirror) by linking it to an `Automerge.Text` object.
- [Automerge-rs](https://github.com/automerge/automerge-rs) is a Rust implementation.
- Persistence with [mpl](https://github.com/automerge/mpl) or [hypermerge](https://github.com/automerge/hypermerge).

Applications examples using Automerge are available: [pushpin](https://github.com/automerge/pushpin) ([live](https://automerge.github.io/pushpin)), [pixel pusher](https://github.com/automerge/pixelpusher) ([DEPRECATED] [trelli](https://github.com/automerge/trellis)).

[Teletype CRDT](https://github.com/atom/teletype-crdt) is string-wise sequence CRDT powering peer-to-peer collaborative editing in [Teletype for Atom](https://teletype.atom.io).

[Local First](https://github.com/jaredly/local-first) (by [jaredforsyth](https://jaredforsyth.com)) is nested object CRDT, a hybrid logical clock with a rich-text CRDT.

[CRDT-sequence](https://github.com/phedkvist/crdt-sequence) (by @phedkvist), with a [server](https://github.com/phedkvist/crdt-server).

[Logux](https://logux.io) has features inspired by CRDT to resolve edit conflicts between users. Real-time updates to prevent conflicts. Time travel to keep actions order the same on every client. A distributed timer to detect the latest changes. It provides a [Server](https://github.com/logux/server) and a [client](https://github.com/logux/client).

[Rust CRDT](https://github.com/rust-crdt/rust-crdt) is a family of CRDT's supporting both State and Op based replication..

## OT

### About OT

OT is an acronym for `Operational Transformation`. OT needs a central server and is used by Google Docs, Office365..

- [Operational Transformation on Wikipedia](https://en.wikipedia.org/wiki/Operational_transformation)
- [Building a real-time collaborative editor using Operational Transformation](https://medium.com/@srijancse/how-real-time-collaborative-editing-work-operational-transformation-ac4902d75682)
- [Operational Transformation, the real time collaborative editing algorithm](https://hackernoon.com/operational-transformation-the-real-time-collaborative-editing-algorithm-bf8756683f66)

Transformation Property TP2 Case.   

- <http://www.thinkbottomup.com.au/site/blog/Google_Wave_Intention_Preservation_Branching_Merging_and_TP2>
- <http://www.thinkbottomup.com.au/site/blog/Google_Wave_Operational_Transform_and_Server_Acknowledgments>
- <https://blog.cocalc.com/2018/10/11/collaborative-editing.html>

Read more on [CKEditor lessons learned](https://ckeditor.com/blog/Lessons-learned-from-creating-a-rich-text-editor-with-real-time-collaboration) and other [Libraries for OT](https://stackoverflow.com/questions/2043165/operational-transformation-library).

### OT Libraries

[ShareDB](https://github.com/share/sharedb) is a realtime database backend based on Operational Transformation (OT) of JSON documents. It is the realtime backend for the DerbyJS web application framework.

- <https://github.com/startupjs/startupjs>
- <https://github.com/startupjs/startupjs/tree/master/packages/react-sharedb>
- [DEPRECATED] <https://github.com/dmapper/react-sharedb>
- [DEPRECATED] <https://github.com/josephg/ShareJS>
- [DEPRECATED] <https://sharejs.org>

[OT.js](https://github.com/Operational-Transformation/ot.js) is not maintained anymore.

## Diffs

### About Diffs

Diffs is more a family of protocols that rely on exchange and merge of diffs. It is used by e.g. [Cocalc](https://blog.cocalc.com/2018/10/11/collaborative-editing.html). Read more on this in the following.

- [Differential Synchronization](https://neil.fraser.name/writing/sync) ([research paper](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/35605.pdf)).
- [Diffs and Merge](https://jneem.github.io/merging).

### Diffs Libraries

[Google Diff-Match-Patch](https://github.com/google/diff-match-patch) offers robust algorithms to perform the operations required for synchronizing plain text. See also [JackuB Diff-Match-Patch](https://github.com/JackuB/diff-match-patch).

[Diff-Sync](https://github.com/janmonschke/diffsync) library. See the [diffsync-todos example](https://github.com/janmonschke/diffsync-todos) deployed on [heroku](https://diffsync-todos.herokuapp.com).

## Mixed

### Microsoft Fluid

[Microsoft Fluid](https://fluidframework.com) has been announced in [May 2020](https://techcommunity.microsoft.com/t5/microsoft-365-blog/introducing-the-first-microsoft-fluid-framework-experiences-in/ba-p/1345543) ([see also this doc](https://support.microsoft.com/en-us/office/get-started-with-fluid-framework-preview-d05278db-b82b-4d1f-8523-cf0c9c2fb2df)). It is now [released](https://github.com/microsoft/fluidframework).

The offered functionalities and how it can be used outside of [Microsoft Office 365](https://www.office.com) are investigated in [jupyterlab/rtc#80](https://github.com/jupyterlab/rtc/issues/80).

From the [Fluid FAQ](https://fluidframework.com/docs/faq/):

- Does Fluid use operational transforms? Fluid does not use Operational Transforms (OT), but we learned a tremendous amount from the literature on OT. While OT uses operations that can be applied out of order by transforming operations to account for recent changes, Fluid relies on a Total Order Broadcast to guarantee that all operations are applied in a specific order.
- Does Fluid use CRDT? Fluid does not use Conflict-Free Replicated Data Types (CRDTs), but our model is more similar to CRDT than OT. The Fluid Framework relies on update-based operations that are ordered using our Total Order Broadcast to prevent conflicts. This allows us to have non-commutative operations because there is an explicit ordering.

On Twitter.

- <https://twitter.com/TSteveLuc/status/1304127430743924736>
- <https://twitter.com/mattetti/status/1304233818576969729>
- <https://twitter.com/martinkl/status/1304166170812190720>

Other information.

- [Introducing distributed data structures](https://fluidframework.com/docs/concepts/dds).
- [How a Fluid Framework service works](https://medium.com/@kurtberglund/how-a-fluid-framework-service-works-c82fe9f78ae9).
- [Deploy and run your own Fluid Framework service](https://medium.com/@kurtberglund/deploy-and-run-your-own-fluid-framework-service-8c82294e74b7).
- [Fluid framework, for building distributed, real-time collaborative web apps](https://news.ycombinator.com/item?id=24417482) (quote: "*Adding more context: Fluid uses a mix of CRDT + OT to maintain state across multiple clients. I wrote a quick high level explanation of how Fluid uses eventual consistency and why it matters for real time collaboration*").
- [Solving Real Time Collaboration Using Eventual Consistency](https://matt.aimonetti.net/posts/2020-09-solving-real-time-collaboration-using-eventual-consistency).

## Others

We review here other algorithms and techniques in the broader `Distributed Computing` domain that could be useful for RTC.

### Paxos

- <https://en.wikipedia.org/wiki/Paxos_(computer_science)>
- <https://en.wikipedia.org/wiki/Gossip_protocol>

### Vector Clocks

- <https://en.wikipedia.org/wiki/Vector_clock>
- <https://www.datastax.com/blog/2013/09/why-cassandra-doesnt-need-vector-clocks>

# Algorithms

We can class the `RTC Algorithms` into 3 main categories:

1. [CRDT](#crdt) category doesn't need a central server and is used by Riak, TomTom GPS, Teletype for Atom...
2. [OT](#ot) category needs a central server and is used by Google Docs, Office365...
3. [Diffs](#diffs) category used by [Cocalc](https://blog.cocalc.com/2018/10/11/collaborative-editing.html)...

We also have an [others](#others) section for algorithm that don't fit into those categories.

The following brings more perspect on how the categories position on each others.

- [To OT or CRDT, that is the question](https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt) and its references
- [Collaborative Editing in CoCalc: OT, CRDT, or something else?](https://blog.cocalc.com/2018/10/11/collaborative-editing.html)
- [Towards a unified theory of Operational Transformation and CRDT](https://medium.com/@raphlinus/towards-a-unified-theory-of-operational-transformation-and-crdt-70485876f72f)
- [Differences between OT and CRDT](https://stackoverflow.com/questions/26694359/differences-between-ot-and-crdt)
- [Operational Transformation library?](https://stackoverflow.com/questions/2043165/operational-transformation-library)
- On Hacker News: [Real Differences Between OT and CRDT for Co-Editors](https://news.ycombinator.com/item?id=18191867)
- On Hacker News: [Fluid framework, for building distributed, real-time collaborative web apps](https://news.ycombinator.com/item?id=24417482) - You can read there: *Adding more context: Fluid uses a mix of CRDT + OT to maintain state across multiple clients. I wrote a quick high level explanation of how Fluid uses eventual consistency and why it matters for real time collaboration* ([more details](https://matt.aimonetti.net/posts/2020-09-solving-real-time-collaboration-using-eventual-consistency))
- [Conclave - A private and secure real-time collaborative text editor](https://conclave-team.github.io/conclave-site)

## CRDT

CRTD is an ancronym for `Conflict-free Replicated Data Type`. CRDT doesn't need a central server and is used by Riak, TomTom GPS, Teletype for Atom.

The following links are useful to discover CRTD in relationship with OT.

- <https://www.youtube.com/watch?v=yCcWpzY8dIA>
- <https://www.youtube.com/watch?v=B5NULPSiOGw>
- <https://www.youtube.com/watch?v=vBU70EjwGfw>

CRDT is about `shared data structures`.

- <https://github.com/yjs/yjs/blob/main/README.md>
- <https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type>
- <https://crdt.tech>

You can also jump into the following links to get more details.

- <https://digitalfreepen.com/2017/10/06/simple-real-time-collaborative-text-editor.html>
- <https://www.youtube.com/watch?v=jIR0Ngov7vo>
- <https://arxiv.org/abs/1608.03960>
- <https://dl.acm.org/doi/10.1145/3359141>
- <https://medium.com/@amberovsky/crdt-conflict-free-replicated-data-types-b4bfc8459d26>
- <https://github.com/yjs/yjs#Yjs-CRDT-Algorithm>
- <https://www.researchgate.net/publication/310212186_Near_Real-Time_Peer-to-Peer_Shared_Editing_on_Extensible_Data_Types>
- <https://www.serverless.com/blog/crdt-explained-supercharge-serverless-at-edge>
- <https://www.infoq.com/presentations/crdt-production>
- <https://www.infoworld.com/article/3305321/when-to-use-a-crdt-based-database.html>
- <https://pierrehedkvist.com/posts/1-creating-a-collaborative-editor>
- <https://www.figma.com/blog/how-figmas-multiplayer-technology-works>
- <https://news.ycombinator.com/item?id=23802208>
- <https://github.com/alangibson/awesome-crdt>

CRDT has some edge cases: [The Hard Parts](https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html) and its references ([slides](https://speakerdeck.com/ept/crdts-the-hard-parts) - [1h10m video](https://www.youtube.com/watch?v=x7drE24geUw))

[RGA Split](https://pages.lip6.fr/Marc.Shapiro/papers/rgasplit-group2016-11.pdf) is a High Responsiveness for Group Editing CRDTs.

Some post-mortem stories can be instructive.

- <https://github.com/xi-editor/xi-editor/issues/1187#issuecomment-491473599>
- <https://news.ycombinator.com/item?id=19886883>

Other information:

- CRDT [is used in Apache Cassandra](https://cassandra.apache.org/doc/latest/architecture/dynamo.html#dataset-partitioning-consistent-hashing).
- [Are CRDTs suitable for shared editing? on Hacker News](https://news.ycombinator.com/item?id=24176455)

## OT

OT is an acronym for `Operational Transformation`. OT needs a central server and is used by Google Docs, Office365.

- <https://en.wikipedia.org/wiki/Operational_transformation>
- <https://medium.com/@srijancse/how-real-time-collaborative-editing-work-operational-transformation-ac4902d75682>
- <https://hackernoon.com/operational-transformation-the-real-time-collaborative-editing-algorithm-bf8756683f66>

TP2 Case

- <http://www.thinkbottomup.com.au/site/blog/Google_Wave_Intention_Preservation_Branching_Merging_and_TP2>
- <http://www.thinkbottomup.com.au/site/blog/Google_Wave_Operational_Transform_and_Server_Acknowledgments>
- <https://blog.cocalc.com/2018/10/11/collaborative-editing.html>

Lessons Learned

- <https://ckeditor.com/blog/Lessons-learned-from-creating-a-rich-text-editor-with-real-time-collaboration>

Libraries for OT

- <https://stackoverflow.com/questions/2043165/operational-transformation-library>

## Diffs

Diffs is more a family of protocols that rely on exchange and merge of diffs. It is used by e.g. [Cocalc](https://blog.cocalc.com/2018/10/11/collaborative-editing.html).

- [Differential Synchronization](https://neil.fraser.name/writing/sync) ([paper](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/35605.pdf).
- [Diffs and Merge](https://jneem.github.io/merging).

## Others

We list here other algorithms in the broader `distributed computing` domain.

**Paxos**

- <https://en.wikipedia.org/wiki/Paxos_(computer_science)>
- <https://en.wikipedia.org/wiki/Gossip_protocol>

**Vector Clocks**

- <https://en.wikipedia.org/wiki/Vector_clock>
- <https://www.datastax.com/blog/2013/09/why-cassandra-doesnt-need-vector-clocks>

# Algorithms

Various `RTC Algorithms` exist and compete in a way.

- <https://www.tiny.cloud/blog/real-time-collaboration-ot-vs-crdt> and its references
- <https://blog.cocalc.com/2018/10/11/collaborative-editing.html>
- <https://medium.com/@raphlinus/towards-a-unified-theory-of-operational-transformation-and-crdt-70485876f72f>
- <https://news.ycombinator.com/item?id=18191867>
- <https://conclave-team.github.io/conclave-site>
- <https://stackoverflow.com/questions/26694359/differences-between-ot-and-crdt>
- <https://stackoverflow.com/questions/2043165/operational-transformation-library>

We can class the RTC Algorithms into 3 families:

1. CRDT (doesn't need a central server): Used by Riak, TomTom GPS, Teletype for Atom...
2. OT (needs a central server): Used by Google Docs, Office365...
3. Diffs: Used by Cocalc...

## CRTD (Conflict-free Replicated Data Type)

To discover CRTD (in relationship with OT), we invite you listening and reading:

- <https://www.youtube.com/watch?v=yCcWpzY8dIA>
- <https://www.youtube.com/watch?v=B5NULPSiOGw>
- <https://www.youtube.com/watch?v=vBU70EjwGfw>

Then jump into the following links.

- <https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type>
- <https://crdt.tech>

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

Edge Cases

- [The Hard Parts](https://martin.kleppmann.com/2020/07/06/crdt-hard-parts-hydra.html) and its references ([slides](https://speakerdeck.com/ept/crdts-the-hard-parts) - [1h10m video](https://www.youtube.com/watch?v=x7drE24geUw))

RGA Split

- <https://pages.lip6.fr/Marc.Shapiro/papers/rgasplit-group2016-11.pdf>

Some post-mortem stories can also be instructive.

- <https://github.com/xi-editor/xi-editor/issues/1187#issuecomment-491473599>
- <https://news.ycombinator.com/item?id=19886883>

Apache Cassandra

- <https://cassandra.apache.org/doc/latest/architecture/dynamo.html#dataset-partitioning-consistent-hashing>

Other discussions

- [Are CRDTs suitable for shared editing? on Hacker News](https://news.ycombinator.com/item?id=24176455)

## OT (Operational Transformation)

- <https://en.wikipedia.org/wiki/Operational_transformation>
- <https://medium.com/@srijancse/how-real-time-collaborative-editing-work-operational-transformation-ac4902d75682>
- <https://hackernoon.com/operational-transformation-the-real-time-collaborative-editing-algorithm-bf8756683f66>

Google Wave

- <https://www.youtube.com/watch?v=uOFzWZrsPV0>
- <https://www.youtube.com/watch?v=3ykZYKCK7AM>

Google Drive

- <https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_22.html>

Google / Dropbox System Design

- <https://www.youtube.com/watch?v=2auwirNBvGg>
- <https://www.youtube.com/watch?v=U2lVmSlDJhg>
- <https://www.youtube.com/watch?v=U0xTu6E2CT8>

TP2 Case

- <http://www.thinkbottomup.com.au/site/blog/Google_Wave_Intention_Preservation_Branching_Merging_and_TP2>
- <http://www.thinkbottomup.com.au/site/blog/Google_Wave_Operational_Transform_and_Server_Acknowledgments>
- <https://blog.cocalc.com/2018/10/11/collaborative-editing.html>

Lessons Learned

- <https://ckeditor.com/blog/Lessons-learned-from-creating-a-rich-text-editor-with-real-time-collaboration>

Libraries for OT

- <https://stackoverflow.com/questions/2043165/operational-transformation-library>

## Differential Synchronization

- <https://neil.fraser.name/writing/sync>
- <https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/35605.pdf>

## Diffs and Merge

- <https://jneem.github.io/merging>

## Other Algorithms

Other algorithms in the `distributed` area.

Paxos

- <https://en.wikipedia.org/wiki/Paxos_(computer_science)>
- <https://en.wikipedia.org/wiki/Gossip_protocol>

Vector Clocks

- <https://en.wikipedia.org/wiki/Vector_clock>
- <https://www.datastax.com/blog/2013/09/why-cassandra-doesnt-need-vector-clocks>

# Persistence

If communications must be persisted, 3 options are available.

1. [Distributed Databases](#distributed-databases)
1. [Distributed Storage](#distributed-storage)
1. [File Synchronisation](#file-synchronisation)

## Distributed Databases

We list here some distributed databases with synchronisation capabilities.

- <https://github.com/pouchdb/pouchdb>
- <https://github.com/citusdata/citus>
- <https://materialize.io/docs>
- <https://github.com/biokoda/actordb>
- <https://gun.eco>
- <https://github.com/kappa-db>
- <https://dzone.com/articles/facebook-announces-apollo-qcon>

## Distributed Storage

Although not purely a RTC aspect, `Distributed Storage` systems often use some RTC under-the-hood,
or can be used as underlying solution for RTC. We list here a few of those storages with useful links.

### DAT

- <https://dat.foundation>
- <https://github.com/datproject/sdk>

Hypercore is a secure, distributed append-only log.

- <https://github.com/hypercore-protocol/hypercore>
- <https://github.com/hypercore-protocol/hyperdrive>

HyperSwarm / Beaker

- <https://pfrazee.hashbase.io/blog/hyperswarm>

- <https://github.com/hyperswarm/hyperswarm>
- <https://github.com/hyperswarm/network>
- <https://github.com/hyperswarm/discovery>
- <https://github.com/hyperswarm/dht>

- <https://beakerbrowser.com>
- <https://github.com/beakerbrowser>

- <https://hyperdrive.network>
- <https://github.com/beakerbrowser/hyperdrive.network>

JupyterLab Extension

- <https://github.com/deathbeds/jupyterlab-dat>

### IPFS

IPFS is a A peer-to-peer hypermedia protocol designed to make the web faster, safer, and more open.

- <https://ipfs.io>
- <https://blog.ipfs.io/30-js-ipfs-crdts>
- <https://github.com/ipfs/research-crdt>

Peerpad to write, collaborate and export markdown documents directly in your browser.

- <https://peerpad.net>
- <https://github.com/peer-base/peer-pad>

### Swarm

- <https://github.com/ethersphere/swarm>
- <https://ethersphere.github.io/swarm-home>

- <https://github.com/gritzko/swarm>
- <https://gritzko.gitbooks.io/swarm-the-protocol/content/crdt.html>

RON (Replicated Object Notation), a distributed live data format

- <https://github.com/gritzko/ron>
- <https://github.com/automerge/automerge/issues/266>

## File Synchronisation

[File Synchronisation](https://en.wikipedia.org/wiki/Comparison_of_file_synchronization_software) is a way to share content, but not really RTC.


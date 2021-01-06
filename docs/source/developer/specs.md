# Specifications

This document is meant to serve as a way to specify the behavior of the protocols being developed in the [jupyterlab/rtc](https://github.com/jupyterlab/rtc) repository. The hope for it would be start here, very much in flux, and then at some point, once it is settled down a bit, move into a [JEP](https://github.com/jupyter/enhancement-proposals).

The goal of these protocols is to provide a shared higher level base for Jupyter clients to build on than the current Jupyter Server or Kernel specifications. In some ways, it can be seen as an expansion and logical continuation of [Konrad Hinsen's Notebook Data Model JEP](https://github.com/jupyter/enhancement-proposals/pull/4).

This is really a family of specifications. They exist in levels, like the [OSI model](https://en.wikipedia.org/wiki/OSI_model#Layer_architecture) (in terms of that stack, they all exist at the Application layer). Each level depends only on the interface provided by the level directly below it and provides an interface to the level above it. They are, from highest to lowest:

1. `Jupyter RTC`: Specification of the schemas that correspond to the entities in the Jupyter Server and a specification of how the supernode interacts with these records. There are other protocols at this level as well, for things like chat, commenting, Jupyter Widgets and other extensions.
2. `RTC`: Specification of how to represent schemas and how updates to the data in those schemas can be serialized as transactions.
3. `Synchronized Append-only Log`: Provides a way to share between all clients a shared append-only log of transactions.
4. `Bidirectional Asynchronous Communication`: Allows clients to send and receive messages to one another.

## Specification Details

### Jupyter RTC Specification

_The shared schemas are in [`@jupyter-rtc/jupyter`](https://github.com/jupyterlab/rtc/blob/main/packages/jupyter/src/schemas.ts) and the supernode is in [`@jupyter-rtc/supernode`](https://github.com/jupyterlab/rtc/blob/main/packages/supernode/src/index.ts)_.

The `Jupyter RTC` specification is meant to normalize data provided by the Jupyter Server into the `RTC` specification.

It specifies the `schemas` this relies on a **data model** and on the behavior of a `supernode`, which connects to the **data model** and interacts with a running Jupyter server. This is a list of schemas, with types written as TS types that can be mapped to JSON schema.

**`executions`**: All the executions that happened on this server:

- `code` string: the code that was executed
- `kernel` `null | {@id: string, session: number}`: Null if the kernel that executed this is unknown (say it was loaded from a serialized notebook), Otherwise the `@id` of the kernel that executed it and the "session" meaning the instance of the kernel in terms of number of restarts. For example, if this kernel has never been restarted before this execution this will be `0`. Otherwise, if it has just been restarted once, then this is executed, it will be `1`, etc.
- `status` `{status: "requested"} | {status: "in progress"} | {status: "ok:, execution_count: number | null, result: null | {data: Object, metadata: Object}} | {status: "abort"} | {status: "error", ename: sting, evalue: string, traceback: string[]}`: The state of the execution... etc
- `displays` List of `{type: "stream", name: "stdout" | "stderr", text: string} | {type: "data", data: Object, metadata: Object, display_id: null | string}`: The sequence of displays from this execution, in the order in which they were recieved.

**`cells`**: All the cells in all notebooks:

- `text` text field: the contents of the cell
- `execution` `string | null`: the most recent execution of the cell or null if it has no execution.
- etc...

About the `supernode`: Any record from the `executions` table that has a state of `"requested"` will be run against the kernel specified in the `kernel` attribute. While it is being run, it will be set to `in progress`. As it is running the `displays` will be added according the messages received back on the ... channels. Once it has finished, the `status` will be changed to one of the `ok`, `abort` or `error` responses.

TODO: Specify this more precisely based on Jupyter messaging specifications [^f1].

### RTC Specification

_This is currently implemented in [`@jupyter-rtc/node`](https://github.com/jupyterlab/rtc/tree/main/lumino/packages/node/src) and by [`@lumino/datastore`](https://github.com/jupyterlab/lumino/tree/master/packages/datastore)_.

The goal of this layer is to allow you to specify data models, and then to execute updates on them, and have these updates translated to serializable transactions that can be shared using the layer below. This is currently "specified" mostly by the `@lumino/datastore` schemas JS package, but we should work at making it implementation agnostic.

A datastore can be initialized with a number of schemas. Each schema has a name and a number of fields. Each of these fields has a name as well as a type and an initial value. The type of a field can be one of:

- Primitive: Any JSON schema.
- A list of values, each can be a JSON Schema.
- A mapping of strings to a value, which can be a JSON schema.
- A text field.

To support for merging between different users simultaneously editing a field, use any of the non primitive fields.

At runtime, the datastore has a list of records for each schema. Each of these records has a special field `@id` which must be unique. The data is changed through applying transactions to it. All transactions that are applied end up on the append only log, defined in the layer below.

Each transaction is a mapping of schema names to a list of updates for those records. An update for a schema is a mapping of field names to a list of updates for that record.

- If it is a primitive value, the update is simply the new value.
- If it is a list, it consists of an index, the number of entries to delete, and a list of entries to add.
- If it is a mapping, it consists of a mapping of keys to their new values.
- If it is a text field, it consists of an index, the number of characters to delete, and a string to add.

Any transaction that refers to a non exist record ID will create that record when received. If the ID exists, that record will be updated with the changes. Records can not be deleted.

TODO: Specify how these transactions are serialized to bytes. Possibly either support just a CRDT spec, just a diff based spec, or some default of the diff based spec with the ability to opt into a CRDT logic if both clients agree. Sort of like HTTP vs HTTP v2.0 protocol upgrade.

TODO: At some point, we may need higher level abstraction, a bit like [primus](https://github.com/primus/primus).

### Synchronized Append-only Log Specification

_This is currently implemented in [`@jupyter-rtc/relay`](https://github.com/jupyterlab/rtc/tree/main/lumino/packages/relay/src)_.

The goal of this specification it to provide all clients with a shared append only log they can add transactions to and read transactions from. This is achieved through a central server that stores the logs which all clients connect to.

- When a new client connects, the server sends a message of type `transactions` that has as its body a list of transactions. A client starts its log with this list of transactions.
- When a client has changes, it sends a `transaction` message to the server and adds it to its local log. This message is forwarded to all other clients.
- When a client receives a transaction message, it adds this to its log.

TODO: Retries, Confirmation, Undo/Redo

### Bidirectional Asynchronous Communication Specification

_This specification provides a way for a client and a server to send each other messages._

We currently use [socket.io](https://github.com/socketio/socket.io) for this. Other options are open for discussions:

- <https://www.cncf.io/blog/2018/10/24/grpc-web-is-going-ga>
- <https://wamp-proto.org>
- <https://web.dev/quictransport>
- <https://webrtc.org>

## Cross-cutting Concerns

### Transactions

Sometimes, you need to ensure that a group of actions make up a unique transactions.

### Sharding / Horizontal Partitioning

If many notebooks are being worked on at once, it might be not feasible to push changes for all of them to all clients.

Therefor, we need [Sharding](https://en.wikipedia.org/wiki/Shard_(database_architecture) (aka Horizontal Partitioning) facilities.

### Permissions

There are many situations where not all clients should be able to do all things.

The simplest way to implement this is a binary write permission, where some clients can send transactions back to the central server and some can only read existing clients.

However, if we want to support more nuanced and granular loads then it is helpful to think about the permissions on two levels:

1. What records can clients create or edit in the data store (at the RTC level, i.e. editing a text cell)
2. What actions can clients cause the supernode to take on the server (at the Jupyter RTC level, i.e. executing a cell)

It may be useful to have security at both levels.

1. For level one, we could add a `token` field to each transaction that gets sent to the central relay server. The relay could then be configurable to reject transactions based on their tokens, by allowing an extension to provide this behavior (either through some kind of FFI or microservice architecture)
2. For level two, we could add a "signed token" to the value of certain actions, by putting it in the state of records, like in the executions schema we could add a `token` property to the `"requested"` state. That way the client could pass that token to the server, the relay node would be unaware of it, but then the RTC jupyter supernode would grab out the token, and pass that on to the Jupyter Server where any custom authentication logic could be used for that request. It would probably have to be signed, maybe through some public/private key encryption, so only the supernode can read the token, not other clients. 

### Multiple Kernel Executors

There have been a couple of points raised by folks that make me think we might wanna support some idea of the current server that an entity is relevant for. The use cases:

- Local instances of kernels in your browser, ala Jyve.
- Having one jupyter client talking to many jupyter servers, if you have work in multiple places.

We could add a `host` field to the `kernelspecs` schemas with a uniqiue ID so that each each server would only execute kernels that come from kernelspecs that it owns.

[^f1]: Jupyter Server specifications.

    - [Kernel Messaging](https://jupyter-client.readthedocs.io/en/stable/messaging.html)
    - [Notebook Server Swagger API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml)
    - [Notebook Server Wiki](https://github.com/jupyter/jupyter/wiki/Jupyter-Notebook-Server-API)
    - [Next Jupyter Server](https://jupyter-server.readthedocs.io)

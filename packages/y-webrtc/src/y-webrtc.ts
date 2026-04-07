/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */
/* eslint-env browser */

import * as ws from 'lib0/websocket';
import * as map from 'lib0/map';
import * as error from 'lib0/error';
import * as random from 'lib0/random';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { ObservableV2 } from 'lib0/observable';
import * as logging from 'lib0/logging';
import * as bc from 'lib0/broadcastchannel';
import * as buffer from 'lib0/buffer';
import * as math from 'lib0/math';
import { createMutex } from 'lib0/mutex';

import * as Y from 'yjs';
import Peer from 'simple-peer';

import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

import * as cryptoutils from './crypto';

const log = logging.createModuleLogger('y-webrtc');

const messageSync = 0;
const messageQueryAwareness = 3;
const messageAwareness = 1;
const messageBcPeerId = 4;

/**
 * Mapping from signaling server URLs to their connections.
 */
const signalingConns = new Map<string, SignalingConn>();

/**
 * Mapping from room names to room instances.
 */
const rooms = new Map<string, Room>();

/**
 * Check if a room is synced with all peers and emit status change if needed.
 */
const checkIsSynced = (room: Room): void => {
  let synced = true;
  room.webrtcConns.forEach(peer => {
    if (!peer.synced) {
      synced = false;
    }
  });
  if ((!synced && room.synced) || (synced && !room.synced)) {
    room.synced = synced;
    room.provider.emit('synced', [{ synced }]);
    log('synced ', logging.BOLD, room.name, logging.UNBOLD, ' with all peers');
  }
};

/**
 * Read an incoming message and create a response if needed.
 */
const readMessage = (
  room: Room,
  buf: Uint8Array,
  syncedCallback: () => void
): encoding.Encoder | null => {
  const decoder = decoding.createDecoder(buf);
  const encoder = encoding.createEncoder();
  const messageType = decoding.readVarUint(decoder);
  if (room === undefined) {
    return null;
  }
  const awareness = room.awareness;
  const doc = room.doc;
  let sendReply = false;
  switch (messageType) {
    case messageSync: {
      encoding.writeVarUint(encoder, messageSync);
      const syncMessageType = syncProtocol.readSyncMessage(
        decoder,
        encoder,
        doc,
        room
      );
      if (
        syncMessageType === syncProtocol.messageYjsSyncStep2 &&
        !room.synced
      ) {
        syncedCallback();
      }
      if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
        sendReply = true;
      }
      break;
    }
    case messageQueryAwareness:
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(
          awareness,
          Array.from(awareness.getStates().keys())
        )
      );
      sendReply = true;
      break;
    case messageAwareness:
      awarenessProtocol.applyAwarenessUpdate(
        awareness,
        decoding.readVarUint8Array(decoder),
        room
      );
      break;
    case messageBcPeerId: {
      const add = decoding.readUint8(decoder) === 1;
      const peerName = decoding.readVarString(decoder);
      if (
        peerName !== room.peerId &&
        ((room.bcConns.has(peerName) && !add) ||
          (!room.bcConns.has(peerName) && add))
      ) {
        const removed: string[] = [];
        const added: string[] = [];
        if (add) {
          room.bcConns.add(peerName);
          added.push(peerName);
        } else {
          room.bcConns.delete(peerName);
          removed.push(peerName);
        }
        room.provider.emit('peers', [
          {
            added,
            removed,
            webrtcPeers: Array.from(room.webrtcConns.keys()),
            bcPeers: Array.from(room.bcConns)
          }
        ]);
        broadcastBcPeerId(room);
      }
      break;
    }
    default:
      console.error('Unable to compute message');
      return encoder;
  }
  if (!sendReply) {
    // nothing has been written, no answer created
    return null;
  }
  return encoder;
};

/**
 * Read a peer message and process it.
 */
const readPeerMessage = (
  peerConn: WebrtcConn,
  buf: Uint8Array
): encoding.Encoder | null => {
  const room = peerConn.room;
  log(
    'received message from ',
    logging.BOLD,
    peerConn.remotePeerId,
    logging.GREY,
    ' (',
    room.name,
    ')',
    logging.UNBOLD,
    logging.UNCOLOR
  );
  return readMessage(room, buf, () => {
    peerConn.synced = true;
    log(
      'synced ',
      logging.BOLD,
      room.name,
      logging.UNBOLD,
      ' with ',
      logging.BOLD,
      peerConn.remotePeerId
    );
    checkIsSynced(room);
  });
};

/**
 * Send a message to a WebRTC connection.
 */
const sendWebrtcConn = (
  webrtcConn: WebrtcConn,
  encoder: encoding.Encoder
): void => {
  log(
    'send message to ',
    logging.BOLD,
    webrtcConn.remotePeerId,
    logging.UNBOLD,
    logging.GREY,
    ' (',
    webrtcConn.room.name,
    ')',
    logging.UNCOLOR
  );
  try {
    webrtcConn.peer.send(encoding.toUint8Array(encoder));
  } catch (e) {
    // ignore send errors
  }
};

/**
 * Broadcast a message to all WebRTC connections in a room.
 */
const broadcastWebrtcConn = (room: Room, m: Uint8Array): void => {
  log('broadcast message in ', logging.BOLD, room.name, logging.UNBOLD);
  room.webrtcConns.forEach(conn => {
    try {
      conn.peer.send(m);
    } catch (e) {
      // ignore send errors
    }
  });
};

/**
 * WebRTC connection to a remote peer.
 */
export class WebrtcConn {
  room: Room;
  remotePeerId: string;
  glareToken: number | undefined;
  closed: boolean;
  connected: boolean;
  synced: boolean;
  peer: Peer.Instance;

  /**
   * @param signalingConn - The signaling connection used to establish this WebRTC connection.
   * @param initiator - Whether this peer initiated the connection.
   * @param remotePeerId - The ID of the remote peer.
   * @param room - The room this connection belongs to.
   */
  constructor(
    signalingConn: SignalingConn,
    initiator: boolean,
    remotePeerId: string,
    room: Room
  ) {
    log('establishing connection to ', logging.BOLD, remotePeerId);
    this.room = room;
    this.remotePeerId = remotePeerId;
    this.glareToken = undefined;
    this.closed = false;
    this.connected = false;
    this.synced = false;
    this.peer = new Peer({ initiator, ...room.provider.peerOpts });
    this.peer.on('signal', signal => {
      if (this.glareToken === undefined) {
        // add some randomness to the timestamp of the offer
        this.glareToken = Date.now() + Math.random();
      }
      publishSignalingMessage(signalingConn, room, {
        to: remotePeerId,
        from: room.peerId,
        type: 'signal',
        token: this.glareToken,
        signal
      });
    });
    this.peer.on('connect', () => {
      log('connected to ', logging.BOLD, remotePeerId);
      this.connected = true;
      // send sync step 1
      const provider = room.provider;
      const doc = provider.doc;
      const awareness = room.awareness;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeSyncStep1(encoder, doc);
      sendWebrtcConn(this, encoder);
      const awarenessStates = awareness.getStates();
      if (awarenessStates.size > 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(
            awareness,
            Array.from(awarenessStates.keys())
          )
        );
        sendWebrtcConn(this, encoder);
      }
    });
    this.peer.on('close', () => {
      this.connected = false;
      this.closed = true;
      if (room.webrtcConns.has(this.remotePeerId)) {
        room.webrtcConns.delete(this.remotePeerId);
        room.provider.emit('peers', [
          {
            removed: [this.remotePeerId],
            added: [],
            webrtcPeers: Array.from(room.webrtcConns.keys()),
            bcPeers: Array.from(room.bcConns)
          }
        ]);
      }
      checkIsSynced(room);
      this.peer.destroy();
      log('closed connection to ', logging.BOLD, remotePeerId);
      announceSignalingInfo(room);
    });
    this.peer.on('error', err => {
      log('Error in connection to ', logging.BOLD, remotePeerId, ': ', err);
      announceSignalingInfo(room);
    });
    this.peer.on('data', data => {
      const answer = readPeerMessage(this, data);
      if (answer !== null) {
        sendWebrtcConn(this, answer);
      }
    });
  }

  destroy(): void {
    this.peer.destroy();
  }
}

/**
 * Broadcast an encrypted message via broadcast channel.
 */
const broadcastBcMessage = (room: Room, m: Uint8Array): Promise<void> =>
  cryptoutils
    .encrypt(m, room.key)
    .then(data => room.mux(() => bc.publish(room.name, data)));

/**
 * Broadcast a message via both broadcast channel and WebRTC connections.
 */
const broadcastRoomMessage = (room: Room, m: Uint8Array): void => {
  if (room.bcconnected) {
    broadcastBcMessage(room, m);
  }
  broadcastWebrtcConn(room, m);
};

/**
 * Announce this room's presence to all signaling connections.
 */
const announceSignalingInfo = (room: Room): void => {
  signalingConns.forEach(conn => {
    // only subscribe if connection is established, otherwise the conn automatically subscribes to all rooms
    if (conn.connected) {
      conn.send({ type: 'subscribe', topics: [room.name] });
      if (room.webrtcConns.size < room.provider.maxConns) {
        publishSignalingMessage(conn, room, {
          type: 'announce',
          from: room.peerId
        });
      }
    }
  });
};

/**
 * Broadcast peer ID via broadcast channel.
 */
const broadcastBcPeerId = (room: Room): void => {
  if (room.provider.filterBcConns) {
    // broadcast peerId via broadcastchannel
    const encoderPeerIdBc = encoding.createEncoder();
    encoding.writeVarUint(encoderPeerIdBc, messageBcPeerId);
    encoding.writeUint8(encoderPeerIdBc, 1);
    encoding.writeVarString(encoderPeerIdBc, room.peerId);
    broadcastBcMessage(room, encoding.toUint8Array(encoderPeerIdBc));
  }
};

/**
 * Room represents a shared document space with peers.
 */
export class Room {
  peerId: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  provider: WebrtcProvider;
  synced: boolean;
  name: string;
  key: CryptoKey | null;
  webrtcConns: Map<string, WebrtcConn>;
  bcConns: Set<string>;
  mux: (f: () => void) => void;
  bcconnected: boolean;
  private _bcSubscriber: (data: ArrayBuffer) => Promise<void>;
  private _docUpdateHandler: (update: Uint8Array, origin: any) => void;
  private _awarenessUpdateHandler: (
    {
      added,
      updated,
      removed
    }: { added: number[]; updated: number[]; removed: number[] },
    origin: any
  ) => void;
  private _beforeUnloadHandler: () => void;

  /**
   * @param doc - The Yjs document.
   * @param provider - The WebRTC provider.
   * @param name - The room name.
   * @param key - The encryption key, or null if encryption is disabled.
   */
  constructor(
    doc: Y.Doc,
    provider: WebrtcProvider,
    name: string,
    key: CryptoKey | null
  ) {
    /**
     * Do not assume that peerId is unique. This is only meant for sending signaling messages.
     */
    this.peerId = random.uuidv4();
    this.doc = doc;
    this.awareness = provider.awareness;
    this.provider = provider;
    this.synced = false;
    this.name = name;
    // @todo make key secret by scoping
    this.key = key;
    this.webrtcConns = new Map();
    this.bcConns = new Set();
    this.mux = createMutex();
    this.bcconnected = false;
    this._bcSubscriber = (data: ArrayBuffer) =>
      cryptoutils.decrypt(new Uint8Array(data), key).then(m =>
        this.mux(() => {
          const reply = readMessage(this, m, () => {});
          if (reply) {
            broadcastBcMessage(this, encoding.toUint8Array(reply));
          }
        })
      );
    /**
     * Listens to Yjs updates and sends them to remote peers
     */
    this._docUpdateHandler = (update: Uint8Array, _origin: any) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      broadcastRoomMessage(this, encoding.toUint8Array(encoder));
    };
    /**
     * Listens to Awareness updates and sends them to remote peers
     */
    this._awarenessUpdateHandler = (
      {
        added,
        updated,
        removed
      }: { added: number[]; updated: number[]; removed: number[] },
      _origin: any
    ) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoderAwareness = encoding.createEncoder();
      encoding.writeVarUint(encoderAwareness, messageAwareness);
      encoding.writeVarUint8Array(
        encoderAwareness,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
      );
      broadcastRoomMessage(this, encoding.toUint8Array(encoderAwareness));
    };

    this._beforeUnloadHandler = () => {
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        [doc.clientID],
        'window unload'
      );
      rooms.forEach(room => {
        room.disconnect();
      });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this._beforeUnloadHandler);
    } else if (typeof process !== 'undefined') {
      process.on('exit', this._beforeUnloadHandler);
    }
  }

  connect(): void {
    this.doc.on('update', this._docUpdateHandler);
    this.awareness.on('update', this._awarenessUpdateHandler);
    // signal through all available signaling connections
    announceSignalingInfo(this);
    const roomName = this.name;
    bc.subscribe(roomName, this._bcSubscriber);
    this.bcconnected = true;
    // broadcast peerId via broadcastchannel
    broadcastBcPeerId(this);
    // write sync step 1
    const encoderSync = encoding.createEncoder();
    encoding.writeVarUint(encoderSync, messageSync);
    syncProtocol.writeSyncStep1(encoderSync, this.doc);
    broadcastBcMessage(this, encoding.toUint8Array(encoderSync));
    // broadcast local state
    const encoderState = encoding.createEncoder();
    encoding.writeVarUint(encoderState, messageSync);
    syncProtocol.writeSyncStep2(encoderState, this.doc);
    broadcastBcMessage(this, encoding.toUint8Array(encoderState));
    // write queryAwareness
    const encoderAwarenessQuery = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessQuery, messageQueryAwareness);
    broadcastBcMessage(this, encoding.toUint8Array(encoderAwarenessQuery));
    // broadcast local awareness state
    const encoderAwarenessState = encoding.createEncoder();
    encoding.writeVarUint(encoderAwarenessState, messageAwareness);
    encoding.writeVarUint8Array(
      encoderAwarenessState,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, [
        this.doc.clientID
      ])
    );
    broadcastBcMessage(this, encoding.toUint8Array(encoderAwarenessState));
  }

  disconnect(): void {
    // signal through all available signaling connections
    signalingConns.forEach(conn => {
      if (conn.connected) {
        conn.send({ type: 'unsubscribe', topics: [this.name] });
      }
    });
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.doc.clientID],
      'disconnect'
    );
    // broadcast peerId removal via broadcastchannel
    const encoderPeerIdBc = encoding.createEncoder();
    encoding.writeVarUint(encoderPeerIdBc, messageBcPeerId);
    encoding.writeUint8(encoderPeerIdBc, 0); // remove peerId from other bc peers
    encoding.writeVarString(encoderPeerIdBc, this.peerId);
    broadcastBcMessage(this, encoding.toUint8Array(encoderPeerIdBc));

    bc.unsubscribe(this.name, this._bcSubscriber);
    this.bcconnected = false;
    this.doc.off('update', this._docUpdateHandler);
    this.awareness.off('update', this._awarenessUpdateHandler);
    this.webrtcConns.forEach(conn => conn.destroy());
  }

  destroy(): void {
    this.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
    } else if (typeof process !== 'undefined') {
      process.off('exit', this._beforeUnloadHandler);
    }
  }
}

/**
 * Open a room for a document.
 */
const openRoom = (
  doc: Y.Doc,
  provider: WebrtcProvider,
  name: string,
  key: CryptoKey | null
): Room => {
  // there must only be one room
  if (rooms.has(name)) {
    throw error.create(`A Yjs Doc connected to room "${name}" already exists!`);
  }
  const room = new Room(doc, provider, name, key);
  rooms.set(name, room);
  return room;
};

/**
 * Publish a signaling message for a room.
 */
const publishSignalingMessage = (
  conn: SignalingConn,
  room: Room,
  data: any
): void => {
  if (room.key) {
    cryptoutils.encryptJson(data, room.key).then(data => {
      conn.send({
        type: 'publish',
        topic: room.name,
        data: buffer.toBase64(data)
      });
    });
  } else {
    conn.send({ type: 'publish', topic: room.name, data });
  }
};

/**
 * Signaling connection to a signaling server.
 */
export class SignalingConn extends ws.WebsocketClient {
  providers: Set<WebrtcProvider>;

  constructor(url: string) {
    super(url);
    this.providers = new Set();
    this.on('connect', () => {
      log(`connected (${url})`);
      const topics = Array.from(rooms.keys());
      this.send({ type: 'subscribe', topics });
      rooms.forEach(room =>
        publishSignalingMessage(this, room, {
          type: 'announce',
          from: room.peerId
        })
      );
    });
    this.on('message', (m: any) => {
      switch (m.type) {
        case 'publish': {
          const roomName = m.topic;
          if (m.clients === 1) {
            const parts = roomName.split(':', 3);
            if (parts.length === 3) {
              // we are the first client and it's a stored document, let's load it
              const fileFormat = parts[0];
              const fileType = parts[1];
              const filePath = parts[2];
              // Find the provider with the matching roomName
              const provider = Array.from(this.providers).find(
                p => p.roomName === roomName
              );
              if (provider && provider.loadDocument) {
                provider.loadDocument(fileFormat, fileType, filePath);
              }
              provider?.emit('firstClient', [{ roomName }]);
            }
          }
          const room = rooms.get(roomName);
          if (room === undefined || typeof roomName !== 'string') {
            return;
          }
          const execMessage = (data: any) => {
            const webrtcConns = room.webrtcConns;
            const peerId = room.peerId;
            if (
              data === null ||
              data.from === peerId ||
              (data.to !== undefined && data.to !== peerId) ||
              room.bcConns.has(data.from)
            ) {
              // ignore messages that are not addressed to this conn, or from clients that are connected via broadcastchannel
              return;
            }
            const emitPeerChange = webrtcConns.has(data.from)
              ? () => {}
              : () =>
                  room.provider.emit('peers', [
                    {
                      removed: [],
                      added: [data.from],
                      webrtcPeers: Array.from(room.webrtcConns.keys()),
                      bcPeers: Array.from(room.bcConns)
                    }
                  ]);
            switch (data.type) {
              case 'announce':
                if (webrtcConns.size < room.provider.maxConns) {
                  map.setIfUndefined(
                    webrtcConns,
                    data.from,
                    () => new WebrtcConn(this, true, data.from, room)
                  );
                  emitPeerChange();
                }
                break;
              case 'signal':
                if (data.signal.type === 'offer') {
                  const existingConn = webrtcConns.get(data.from);
                  if (existingConn) {
                    const remoteToken = data.token;
                    const localToken = existingConn.glareToken;
                    if (localToken && localToken > remoteToken) {
                      log('offer rejected: ', data.from);
                      return;
                    }
                    // if we don't reject the offer, we will be accepting it and answering it
                    existingConn.glareToken = undefined;
                  }
                }
                if (data.signal.type === 'answer') {
                  log('offer answered by: ', data.from);
                  const existingConn = webrtcConns.get(data.from);
                  if (existingConn) {
                    existingConn.glareToken = undefined;
                  }
                }
                if (data.to === peerId) {
                  map
                    .setIfUndefined(
                      webrtcConns,
                      data.from,
                      () => new WebrtcConn(this, false, data.from, room)
                    )
                    .peer.signal(data.signal);
                  emitPeerChange();
                }
                break;
            }
          };
          if (room.key) {
            if (typeof m.data === 'string') {
              cryptoutils
                .decryptJson(buffer.fromBase64(m.data), room.key)
                .then(execMessage);
            }
          } else {
            execMessage(m.data);
          }
        }
      }
    });
    this.on('disconnect', () => log(`disconnect (${url})`));
  }
}

/**
 * Options for configuring the WebrtcProvider.
 */
export interface IProviderOptions {
  /** Array of signaling server URLs. */
  signaling?: string[];
  /** Password for room encryption. */
  password?: string | null;
  /** Awareness instance for tracking user presence. */
  awareness?: awarenessProtocol.Awareness;
  /** Maximum number of simultaneous WebRTC connections. */
  maxConns?: number;
  /** Whether to filter broadcast channel connections. */
  filterBcConns?: boolean;
  /** Simple-peer configuration options. */
  peerOpts?: Peer.Options;
  /** Function to load document content. */
  loadDocument?:
    | ((format: string, type: string, path: string) => Promise<any>)
    | null;
}

/**
 * Events emitted by WebrtcProvider.
 */
export interface IWebrtcProviderEvents {
  status: (event: { connected: boolean }) => void;
  synced: (event: { synced: boolean }) => void;
  peers: (event: {
    added: string[];
    removed: string[];
    webrtcPeers: string[];
    bcPeers: string[];
  }) => void;
  firstClient: (event: { roomName: string }) => void;
}

/**
 * Emit status change for a provider.
 */
const emitStatus = (provider: WebrtcProvider): void => {
  provider.emit('status', [{ connected: provider.connected }]);
};

/**
 * WebRTC provider for Yjs documents.
 */
export class WebrtcProvider extends ObservableV2<IWebrtcProviderEvents> {
  roomName: string;
  doc: Y.Doc;
  filterBcConns: boolean;
  awareness: awarenessProtocol.Awareness;
  shouldConnect: boolean;
  signalingUrls: string[];
  signalingConns: SignalingConn[];
  maxConns: number;
  peerOpts: Peer.Options;
  loadDocument:
    | ((format: string, type: string, path: string) => Promise<any>)
    | null;
  key: Promise<CryptoKey | null>;
  room: Room | null;

  /**
   * @param roomName - The name of the room to join.
   * @param doc - The Yjs document to sync.
   * @param opts - Provider options.
   */
  constructor(
    roomName: string,
    doc: Y.Doc,
    {
      signaling = [],
      password = null,
      awareness = new awarenessProtocol.Awareness(doc),
      maxConns = 20 + math.floor(random.rand() * 15), // the random factor reduces the chance that n clients form a cluster
      filterBcConns = true,
      peerOpts = {}, // simple-peer options. See https://github.com/feross/simple-peer#peer--new-peeropts
      loadDocument = null
    }: IProviderOptions = {}
  ) {
    super();
    this.roomName = roomName;
    this.doc = doc;
    this.filterBcConns = filterBcConns;
    this.awareness = awareness;
    this.shouldConnect = false;
    this.signalingUrls = signaling;
    this.signalingConns = [];
    this.maxConns = maxConns;
    this.peerOpts = peerOpts;
    this.loadDocument = loadDocument;
    this.key = password
      ? cryptoutils.deriveKey(password, roomName)
      : Promise.resolve(null);
    this.room = null;
    this.key.then(key => {
      this.room = openRoom(doc, this, roomName, key);
      if (this.shouldConnect) {
        this.room.connect();
      } else {
        this.room.disconnect();
      }
      emitStatus(this);
    });
    this.connect();
    this.destroy = this.destroy.bind(this);
    doc.on('destroy', this.destroy);
  }

  /**
   * Indicates whether the provider is looking for other peers.
   *
   * Other peers can be found via signaling servers or via broadcastchannel (cross browser-tab
   * communication). You never know when you are connected to all peers. You also don't know if
   * there are other peers. connected doesn't mean that you are connected to any physical peers
   * working on the same resource as you. It does not change unless you call provider.disconnect()
   *
   * `this.on('status', (event) => { console.log(event.connected) })`
   */
  get connected(): boolean {
    return this.room !== null && this.shouldConnect;
  }

  connect(): void {
    this.shouldConnect = true;
    this.signalingUrls.forEach(url => {
      const signalingConn = map.setIfUndefined(
        signalingConns,
        url,
        () => new SignalingConn(url)
      );
      this.signalingConns.push(signalingConn);
      signalingConn.providers.add(this);
    });
    if (this.room) {
      this.room.connect();
      emitStatus(this);
    }
  }

  disconnect(): void {
    this.shouldConnect = false;
    this.signalingConns.forEach(conn => {
      conn.providers.delete(this);
      if (conn.providers.size === 0) {
        conn.destroy();
        signalingConns.delete(conn.url);
      }
    });
    if (this.room) {
      this.room.disconnect();
      emitStatus(this);
    }
  }

  destroy(): void {
    this.disconnect();
    this.doc.off('destroy', this.destroy);
    // need to wait for key before deleting room
    this.key.then(() => {
      if (this.room) {
        this.room.destroy();
        rooms.delete(this.roomName);
      }
    });
    super.destroy();
  }
}

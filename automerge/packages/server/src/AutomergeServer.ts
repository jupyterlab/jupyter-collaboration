import WebSocket from 'ws'

const http = require('http')

import { IncomingMessage } from 'http'

import Automerge, { List, Text } from 'automerge'

import { decodeChanges } from 'automerge/backend/columnar';

export const docs = new Map<string, Room>()

export type AmDoc = {
  [key: string]: any
};

const WS_READY_STATE_CONNECTING = 0

const WS_READY_STATE_OPEN = 1

const INITIAL_TEXT = 'Initial content loaded from Server.'

const INITIAL_NOTEBOOK = {
  "nbformat": 4,
  "nbformat_minor": 5,
  "metadata": {
    "kernelspec": {
     "display_name": "Python 3",
     "language": "python",
     "name": "python3"
    },
    "language_info": {
     "codemirror_mode": {
      "name": "ipython",
      "version": 3
     },
     "file_extension": ".py",
     "mimetype": "text/x-python",
     "name": "python",
     "nbconvert_exporter": "python",
     "pygments_lexer": "ipython3",
     "version": "3.8.6"
    }
   },
   "cells": [
   {
    "id": "imposed-compiler",
    "cell_type": "code",
    "execution_count": null,
    "metadata": {
     "mimeType": "text/x-ipython"
    },
    "outputs": [],
    "source": [
     ""
    ]
   },
   {
    "cell_type": "code",
    "execution_count": null,
    "id": "connected-bumper",
    "metadata": {
     "mimeType": "text/x-ipython"
    },
    "outputs": [],
    "source": [
     "print('hello')dd"
    ]
   },
  ],
 }

export const combine = (changes: Uint8Array[]) => {
  // Get the total length of all arrays.
  let length = 0;
  changes.forEach(item => {
    length += item.length;
  });
  // Create a new array with total length and merge all source arrays.
  let combined = new Uint8Array(length);
  let offset = 0;
  changes.forEach(change => {
    combined.set(change, offset);
    offset += change.length;
  });
  return combined;
}

export const createLock = () => {
  let lock = true;
  return (a: any, b: any) => {
    if (lock) {
      lock = false;
      try {
        a();
      } finally {
        lock = true;
      }
    } else if (b !== undefined) {
      b();
    }
  };
};

export const lock = createLock()

const broadcastChanges = (conn: WebSocket, doc: Room, changes: Uint8Array[]) => {
  if (conn.readyState !== WS_READY_STATE_CONNECTING && conn.readyState !== WS_READY_STATE_OPEN) {
    onClose(conn, doc, null)
  }
  try {
    const combined = combine(changes)
    conn.send(combined, err => { err != null && onClose(conn, doc, err) })  
  } catch (e) {
    onClose(conn, doc, e)
  }
}

class Room {
  private name = null;
  public doc: AmDoc = null;
  public conns = new Map()
  constructor(doc: AmDoc) {
    this.doc = doc;
  }
}

const onMessage = (currentConn: WebSocket, docName: string, room: Room, message: any) => {
  lock(() => {
    const changes = new Uint8Array(message)
    room.doc = Automerge.applyChanges(room.doc, [changes])
    /*
    console.log('-------------------------------------------------------------')
    console.log("Change")
    console.log("> ", docName, decodeChanges([changes])[0].message)
    console.log('------')
    console.log('Doc', docName, room.doc)
    console.log('------')
    console.log('Notebook', docName, room.doc['notebook'])
    if (room.doc.notebook && room.doc.notebook.cellOrder) {
      console.log('------')
      console.log('Notebook CellOrder')
      console.log(room.doc.notebook.cellOrder)
    }
    if (room.doc.notebook && room.doc.notebook.cells) {
      console.log('------')
      console.log('Notebook Cells')
      room.doc.notebook.cellOrder.map(id => {
        const cell = room.doc.notebook.cells[id]
        if (cell.codeEditor && cell.codeEditor.value) {
          console.log('> ', cell.codeEditor.value.toString())
        }
        console.log(cell)
      })
    }
    */
    room.conns.forEach((_, conn) => {
      if (currentConn != conn ) {
        broadcastChanges(conn, room, [changes])
      }
    })  
  }, () => {})
}

export const getRoom = (uuid: string, docName: string, initialize: boolean): Room => {
  let k = docs.get(docName)
  if (k) {
   return k
  }
  let doc = Automerge.init<AmDoc>(
//    { actorId: uuid}
  )
  if (initialize) {
    doc = Automerge.change(doc, d => {
      d['ownerId'] = uuid
//      d.codeEditor = {}
//      d.codeEditor.value = new Text()
//      d.codeEditor.value.insertAt(0, ...INITIAL_TEXT)
//      d.notebook = {}
//      d.notebook.cells = new Array()
    })
  }
  console.log('Initial Doc', doc)
  const room = new Room(doc)
  docs.set(docName, room)
  return room
}

const onClose = (conn: WebSocket, doc: Room, err) => {
  console.log('Closing WS', err)
  if (doc.conns.has(conn)) {
    doc.conns.delete(conn)
  }
  conn.close()
}

const setupWSConnection = (conn: WebSocket, req: IncomingMessage) => {
  const urlPath = req.url.slice(1).split('?')[0]
  const params = req.url.slice(1).split('?')[1]
  let initialize = false;
  if (params && params.indexOf('initialize') > -1) {
    initialize = true
  }
  const uuid = urlPath.split('/')[0]
  const docName = urlPath.split('/')[1]
  console.log('Setup WS Connection', uuid, docName)
  conn.binaryType = 'arraybuffer'
  const room = getRoom(uuid, docName, initialize)
  const changes = Automerge.getChanges(Automerge.init<AmDoc>(), room.doc)
  broadcastChanges(conn, room, changes);
  room.conns.set(conn, new Set())
  conn.on('message', message => onMessage(conn, docName, room, message))
  conn.on('close', err => onClose(conn, room, err))
}

const PORT = process.env.PORT || 4321
const wss = new WebSocket.Server({ noServer: true })

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('okay')
})

wss.on('connection', setupWSConnection)

server.on('upgrade', (request, socket, head) => {
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(PORT)

console.log('WebSocket server running on port', PORT)

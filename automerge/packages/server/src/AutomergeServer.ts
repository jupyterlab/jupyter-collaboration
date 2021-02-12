import WebSocket from 'ws'

const http = require('http')

import { IncomingMessage } from 'http'

import Automerge, { List, Text } from 'automerge'

import { decodeChanges } from 'automerge/backend/columnar';

export const docs = new Map<string, AMSharedDoc>()

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

const broadcastChanges = (conn: WebSocket, doc: AMSharedDoc, changes: Uint8Array[]) => {
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

class AMSharedDoc {
  private name = null;
  public doc: AmDoc = null;
  public conns = new Map()
  constructor(doc: AmDoc) {
    this.doc = doc;
  }
}

const onMessage = (currentConn: WebSocket, docName: string, sharedDoc: AMSharedDoc, message: any) => {
  lock(() => {
    const changes = new Uint8Array(message)
    console.log('-------------------------------------------------------------')
    console.log("Change", docName, decodeChanges([changes]))
    sharedDoc.doc = Automerge.applyChanges(sharedDoc.doc, [changes])
    console.log('------')
    console.log('Doc', docName, sharedDoc.doc)
    console.log('------')
    console.log('Notebook', docName, sharedDoc.doc['notebook'])
    console.log('------')
    console.log('Notebook Cells')
    if (sharedDoc.doc.notebook && sharedDoc.doc.notebook.cells) {
      sharedDoc.doc.notebook.cells.map(cell => {
        if (cell.codeEditor && cell.codeEditor.value) {
          console.log('> ', cell.codeEditor.value.toString())
        }
        console.log(cell)
      })
    }
    sharedDoc.conns.forEach((_, conn) => {
      if (currentConn != conn ) {
        broadcastChanges(conn, sharedDoc, [changes])
      }
    })  
  }, () => {})
}

export const getAmSharedDoc = (uuid: string, docName: string, initialize: boolean): AMSharedDoc => {
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
      /*
      d.codeEditor = {}
      d.codeEditor.value = new Text()
      d.codeEditor.value.insertAt(0, ...INITIAL_TEXT)
      d.notebook = {}
      d.notebook.cells = new Array()
      */
    })
  }
  console.log('Initial Doc', doc)
  const sharedDoc = new AMSharedDoc(doc)
  docs.set(docName, sharedDoc)
  return sharedDoc
}

const onClose = (conn: WebSocket, doc: AMSharedDoc, err) => {
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
  if (params.indexOf('initialize') > -1) {
    initialize = true
  }
  const uuid = urlPath.split('/')[0]
  const docName = urlPath.split('/')[1]
  console.log('Setup WS Connection', uuid, docName)
  conn.binaryType = 'arraybuffer'
  const sharedDoc = getAmSharedDoc(uuid, docName, initialize)
  const changes = Automerge.getChanges(Automerge.init<AmDoc>(), sharedDoc.doc)
  broadcastChanges(conn, sharedDoc, changes);
  sharedDoc.conns.set(conn, new Set())
  conn.on('message', message => onMessage(conn, docName, sharedDoc, message))
  conn.on('close', err => onClose(conn, sharedDoc, err))
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

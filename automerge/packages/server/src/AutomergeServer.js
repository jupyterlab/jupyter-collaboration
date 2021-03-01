"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRoom = exports.lock = exports.createLock = exports.combine = exports.docs = void 0;
const ws_1 = __importDefault(require("ws"));
const http = require('http');
const automerge_1 = __importDefault(require("automerge"));
exports.docs = new Map();
const WS_READY_STATE_CONNECTING = 0;
const WS_READY_STATE_OPEN = 1;
const INITIAL_TEXT = 'Initial content loaded from Server.';
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
};
const combine = (changes) => {
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
};
exports.combine = combine;
const createLock = () => {
    let lock = true;
    return (a, b) => {
        if (lock) {
            lock = false;
            try {
                a();
            }
            finally {
                lock = true;
            }
        }
        else if (b !== undefined) {
            b();
        }
    };
};
exports.createLock = createLock;
exports.lock = exports.createLock();
const broadcastChanges = (conn, doc, changes) => {
    if (conn.readyState !== WS_READY_STATE_CONNECTING && conn.readyState !== WS_READY_STATE_OPEN) {
        onClose(conn, doc, null);
    }
    try {
        const combined = exports.combine(changes);
        conn.send(combined, err => { err != null && onClose(conn, doc, err); });
    }
    catch (e) {
        onClose(conn, doc, e);
    }
};
class Room {
    constructor(doc) {
        this.name = null;
        this.doc = null;
        this.conns = new Map();
        this.doc = doc;
    }
}
const onMessage = (currentConn, docName, room, message) => {
    exports.lock(() => {
        const changes = new Uint8Array(message);
        room.doc = automerge_1.default.applyChanges(room.doc, [changes]);
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
            if (currentConn != conn) {
                broadcastChanges(conn, room, [changes]);
            }
        });
    }, () => { });
};
const getRoom = (uuid, docName, initialize) => {
    let k = exports.docs.get(docName);
    if (k) {
        return k;
    }
    let doc = automerge_1.default.init(
    //    { actorId: uuid}
    );
    if (initialize) {
        doc = automerge_1.default.change(doc, d => {
            d['ownerId'] = uuid;
            //      d.codeEditor = {}
            //      d.codeEditor.value = new Text()
            //      d.codeEditor.value.insertAt(0, ...INITIAL_TEXT)
            //      d.notebook = {}
            //      d.notebook.cells = new Array()
        });
    }
    console.log('Initial Doc', doc);
    const room = new Room(doc);
    exports.docs.set(docName, room);
    return room;
};
exports.getRoom = getRoom;
const onClose = (conn, doc, err) => {
    console.log('Closing WS', err);
    if (doc.conns.has(conn)) {
        doc.conns.delete(conn);
    }
    conn.close();
};
const setupWSConnection = (conn, req) => {
    const urlPath = req.url.slice(1).split('?')[0];
    const params = req.url.slice(1).split('?')[1];
    let initialize = false;
    if (params && params.indexOf('initialize') > -1) {
        initialize = true;
    }
    const uuid = urlPath.split('/')[0];
    const docName = urlPath.split('/')[1];
    console.log('Setup WS Connection', uuid, docName);
    conn.binaryType = 'arraybuffer';
    const room = exports.getRoom(uuid, docName, initialize);
    const changes = automerge_1.default.getChanges(automerge_1.default.init(), room.doc);
    broadcastChanges(conn, room, changes);
    room.conns.set(conn, new Set());
    conn.on('message', message => onMessage(conn, docName, room, message));
    conn.on('close', err => onClose(conn, room, err));
};
const PORT = process.env.PORT || 4321;
const wss = new ws_1.default.Server({ noServer: true });
const server = http.createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end('okay');
});
wss.on('connection', setupWSConnection);
server.on('upgrade', (request, socket, head) => {
    const handleAuth = ws => {
        wss.emit('connection', ws, request);
    };
    wss.handleUpgrade(request, socket, head, handleAuth);
});
server.listen(PORT);
console.log('WebSocket server running on port', PORT);
//# sourceMappingURL=AutomergeServer.js.map
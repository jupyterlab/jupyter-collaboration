/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { User } from '@jupyterlab/services';

import { IDisposable } from '@lumino/disposable';
import { IStream, Signal, Stream } from '@lumino/signaling';

import { IAwareness } from '@jupyter/ydoc';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebsocketProvider } from 'y-websocket';

import { MessageType } from './utils';
import { IAwarenessProvider } from './tokens';

export interface IContent {
  type: string;
  body: string;
}

export interface IChatMessage {
  sender: User.IIdentity;
  timestamp: number;
  server_ts?: number;
  content: {
    type: string;
    body: string;
  };
}

interface IMessage extends Omit<IChatMessage, 'sender'> {
  sender: string;
}

/**
 * A class to provide Yjs synchronization over WebSocket.
 *
 * We specify custom messages that the server can interpret. For reference please look in yjs_ws_server.
 *
 */
export class WebSocketAwarenessProvider
  extends WebsocketProvider
  implements IAwarenessProvider, IDisposable
{
  /**
   * Construct a new WebSocketAwarenessProvider
   *
   * @param options The instantiation options for a WebSocketAwarenessProvider
   */
  constructor(options: WebSocketAwarenessProvider.IOptions) {
    super(options.url, options.roomID, options.awareness.doc, {
      awareness: options.awareness
    });

    const user = options.user;
    this._user = Private.getUser(user);
    user.ready
      .then(() => this._onUserChanged(user))
      .catch(e => console.error(e));
    user.userChanged.connect(this._onUserChanged, this);

    this._messageStream = new Stream(this);

    this.messageHandlers[MessageType.CHAT] = (
      encoder,
      decoder,
      provider,
      emitSynced,
      messageType
    ) => {
      const content = decoding.readVarString(decoder);
      const data = JSON.parse(content);

      const state = this.awareness.getStates();
      state.forEach((value: any) => {
        const u: User.IIdentity = value.user;
        if (u.username === data.sender) {
          data.sender = u;
        }
      });

      this._messageStream.emit(data);
    };
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * A signal to subscribe for incoming messages.
   */
  get messageStream(): IStream<this, IChatMessage> {
    return this._messageStream;
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }

    Signal.clearData(this);
    this._isDisposed = true;
    this.destroy();
  }

  /**
   * Send a message to every collaborator.
   *
   * @param msg message
   */
  sendMessage(msg: string): IChatMessage {
    const message: IMessage = {
      sender: this._user.username,
      timestamp: Date.now(),
      content: {
        type: 'text/plain',
        body: msg
      }
    };

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.CHAT);
    encoding.writeVarString(encoder, JSON.stringify(message));
    this.ws!.send(encoding.toUint8Array(encoder));

    return { ...message, sender: this._user };
  }

  private _onUserChanged(user: User.IManager): void {
    this._user = Private.getUser(user);
    this.awareness.setLocalStateField('user', user.identity);
  }

  private _isDisposed = false;
  private _user: User.IIdentity;

  private _messageStream: Stream<this, IChatMessage>;
}

/**
 * A namespace for WebSocketAwarenessProvider statics.
 */
export namespace WebSocketAwarenessProvider {
  /**
   * The instantiation options for a WebSocketAwarenessProvider.
   */
  export interface IOptions {
    /**
     * The server URL
     */
    url: string;

    /**
     * The room ID
     */
    roomID: string;

    /**
     * The awareness object
     */
    awareness: IAwareness;

    /**
     * The user data
     */
    user: User.IManager;
  }
}

namespace Private {
  export function getUser(user: User.IManager): User.IIdentity {
    if (user.identity) {
      return user.identity;
    } else {
      return {
        name: 'Antonymous',
        username: 'Antonymous',
        display_name: 'Antonymous',
        initials: 'A',
        color: '#FFFFFF'
      };
    }
  }
}

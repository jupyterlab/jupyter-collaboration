/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { User } from '@jupyterlab/services';

import { IDisposable } from '@lumino/disposable'
import { ISignal, Signal } from '@lumino/signaling';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { WebsocketProvider } from 'y-websocket';

import { IAwareness, IAwarenessProvider } from './tokens';


export enum MessageType {
  CHAT = 125
};

export interface IChatMessage {
  username: string;
  msg: string;
};

/**
 * A class to provide Yjs synchronization over WebSocket.
 *
 * We specify custom messages that the server can interpret. For reference please look in yjs_ws_server.
 *
 */
export class WebSocketAwarenessProvider extends WebsocketProvider implements IAwarenessProvider, IDisposable {
  /**
   * Construct a new WebSocketAwarenessProvider
   *
   * @param options The instantiation options for a WebSocketAwarenessProvider
   */
  constructor(options: WebSocketAwarenessProvider.IOptions) {
	super(
		options.url,
		options.roomID,
		options.awareness.doc,
		{ awareness: options.awareness }
	);
    
    this._awareness = options.awareness;

    const user = options.user;
    user.ready.then(() => this._onUserChanged(user))
      .catch(e => console.error(e));
    user.userChanged.connect(this._onUserChanged, this);

    this._chatMessage = new Signal(this);

    this.messageHandlers[MessageType.CHAT] = (
      encoder,
      decoder,
      provider,
      emitSynced,
      messageType
    ) => {
      const content = decoding.readVarString(decoder);
      const data = JSON.parse(content) as IChatMessage;
      console.debug("Chat:", data);
      this._chatMessage.emit(data);
    };
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * A signal to subscribe for incoming messages.
   */
  get chatMessage(): ISignal<this, IChatMessage> {
    return this._chatMessage;
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }


    this.destroy();
    this._isDisposed = true;
  }

  /**
   * Send a message to every collaborator.
   * 
   * @param msg message
   */
  sendMessage(msg: string): void {
    console.debug("Send message:", msg);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.CHAT);
    encoding.writeVarString(encoder, msg);
    this.ws!.send(encoding.toUint8Array(encoder));
  }

  private _onUserChanged(user: User.IManager): void {
    this._awareness.setLocalStateField('user', user.identity);
  }

  private _isDisposed: boolean = false;
  private _awareness: IAwareness;

  private _chatMessage: Signal<this, IChatMessage>;
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

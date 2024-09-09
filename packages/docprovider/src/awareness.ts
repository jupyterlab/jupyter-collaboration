/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { User } from '@jupyterlab/services';

import { IDisposable } from '@lumino/disposable';

import { IAwareness } from '@jupyter/ydoc';

import { WebsocketProvider } from 'y-websocket';

export interface IContent {
  type: string;
  body: string;
}

/**
 * A class to provide Yjs synchronization over WebSocket.
 *
 * We specify custom messages that the server can interpret. For reference please look in yjs_ws_server.
 *
 */
export class WebSocketAwarenessProvider
  extends WebsocketProvider
  implements IDisposable
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

    this._awareness = options.awareness;

    this._user = options.user;
    this._user.ready
      .then(() => this._onUserChanged(this._user))
      .catch(e => console.error(e));
    this._user.userChanged.connect(this._onUserChanged, this);
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }

    this._user.userChanged.disconnect(this._onUserChanged, this);
    this._isDisposed = true;
    this.destroy();
  }

  private _onUserChanged(user: User.IManager): void {
    this._awareness.setLocalStateField('user', user.identity);
  }

  private _isDisposed = false;
  private _user: User.IManager;
  private _awareness: IAwareness;
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

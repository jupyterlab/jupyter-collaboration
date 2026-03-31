/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { ServerConnection, User } from '@jupyterlab/services';

import { IAwareness } from '@jupyter/ydoc';

import { WebsocketProvider } from 'y-websocket';

import { WebrtcProvider } from '@jupyter/y-webrtc';

import { IAwarenessProvider } from './tokens';

import { URLExt } from '@jupyterlab/coreutils';

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
  implements IAwarenessProvider
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

    this.awareness = options.awareness;

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
    this.awareness.setLocalStateField('user', user.identity);
  }

  readonly awareness: IAwareness;
  private _isDisposed = false;
  private _user: User.IManager;
}

/**
 * A class to provide Yjs synchronization over WebRTC.
 *
 */
export class WebRTCAwarenessProvider
  extends WebrtcProvider
  implements IAwarenessProvider
{
  /**
   * Construct a new WebRTCAwarenessProvider
   *
   * @param options The instantiation options for a WebRTCAwarenessProvider
   */
  constructor(options: WebRTCAwarenessProvider.IOptions) {
    const serverSettings =
      options.serverSettings ?? ServerConnection.makeSettings();
    const signalingUrls =
      options.signalingUrls.length > 0
        ? options.signalingUrls
        : [URLExt.join(serverSettings.wsUrl, 'api/signaling')];
    super(options.roomID, options.awareness.doc, {
      signaling: signalingUrls,
      awareness: options.awareness
    });

    this.awareness = options.awareness;

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
    this.awareness.setLocalStateField('user', user.identity);
  }

  readonly awareness: IAwareness;
  private _isDisposed = false;
  private _user: User.IManager;
}

/**
 * A namespace for WebRTCAwarenessProvider statics.
 */
export namespace WebRTCAwarenessProvider {
  /**
   * The instantiation options for a WebRTCAwarenessProvider.
   */
  export interface IOptions {
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

    /**
     * The server settings.
     */
    serverSettings?: ServerConnection.ISettings;

    /**
     * The signaling server URLs for WebRTC.
     * If empty, defaults to the server's WebSocket URL with path 'api/signaling'.
     */
    signalingUrls: string[];
  }
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

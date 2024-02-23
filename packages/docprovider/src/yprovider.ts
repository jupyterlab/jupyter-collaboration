/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { showErrorMessage, Dialog } from '@jupyterlab/apputils';
import { User } from '@jupyterlab/services';
import { TranslationBundle } from '@jupyterlab/translation';

import { PromiseDelegate } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';

import { DocumentChange, IDocumentProvider, YDocument } from '@jupyter/ydoc';

import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider as YWebsocketProvider } from 'y-websocket';

import { requestDocFork, requestDocSession } from './requests';


/**
 * A class to provide Yjs synchronization over WebSocket.
 *
 * We specify custom messages that the server can interpret. For reference please look in yjs_ws_server.
 *
 */
export class WebSocketProvider implements IDocumentProvider {
  /**
   * Construct a new WebSocketProvider
   *
   * @param options The instantiation options for a WebSocketProvider
   */
  constructor(options: WebSocketProvider.IOptions) {
    this._isDisposed = false;
    this._isFork = options.isFork || false;
    this._sessionId = options.sessionId || '';
    this._path = options.path;
    this._contentType = options.contentType;
    this._format = options.format;
    this._serverUrl = options.url;
    this._sharedModel = options.model;
    this._awareness = options.model.awareness;
    this._yWebsocketProvider = null;
    this._trans = options.translator;
    this._user = options.user;

    this._user.ready
      .then(() => {
        this._onUserChanged(this._user);
      })
      .catch(e => console.error(e));
    this._user.userChanged.connect(this._onUserChanged, this);

    this._connect().catch(e => console.warn(e));
  }

  /**
   * Test whether the object has been disposed.
   */
  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /**
   * A promise that resolves when the document provider is ready.
   */
  get ready(): Promise<void> {
    return this._ready.promise;
  }

  /**
   * Dispose of the resources held by the object.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._yWebsocketProvider?.off('connection-close', this._onConnectionClosed);
    this._yWebsocketProvider?.off('sync', this._onSync);
    this._yWebsocketProvider?.destroy();
    Signal.clearData(this);
  }

  async fork(): Promise<void> {
    this._yWebsocketProvider?.disconnect();

    const session = await requestDocSession(
      this._format,
      this._contentType,
      this._path
    );

    const response = await requestDocFork(`${session.format}:${session.type}:${session.fileId}`);
    const forkId = response.roomId;

    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      forkId,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params: { sessionId: session.sessionId },
        awareness: this._awareness
      }
    );

    this._sharedModel.addFork(forkId);
  }

  connectFork(forkId: string, sharedModel: YDocument<DocumentChange>): IDocumentProvider {
    return new WebSocketProvider({
      isFork: true,
      sessionId: this._sessionId,
      url: this._serverUrl,
      path: forkId,
      format: '',
      contentType: '',
      model: sharedModel,
      user: this._user,
      translator: this._trans
    });
  }

  private async _connect(): Promise<void> {
    var roomId: string;
    if (this._isFork) {
      roomId = this._path;
    }
    else {
      const session = await requestDocSession(
        this._format,
        this._contentType,
        this._path
      );
      roomId = `${session.format}:${session.type}:${session.fileId}`;
      this._sessionId = session.sessionId;
    }

    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      roomId,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params: { sessionId: this._sessionId! },
        awareness: this._awareness
      }
    );

    this._yWebsocketProvider.on('sync', this._onSync);
    this._yWebsocketProvider.on('connection-close', this._onConnectionClosed);
  }

  private _onUserChanged(user: User.IManager): void {
    this._awareness.setLocalStateField('user', user.identity);
  }

  private _onConnectionClosed = (event: any): void => {
    if (event.code === 1003) {
      console.error('Document provider closed:', event.reason);

      showErrorMessage(this._trans.__('Document session error'), event.reason, [
        Dialog.okButton()
      ]);

      // Dispose shared model immediately. Better break the document model,
      // than overriding data on disk.
      this._sharedModel.dispose();
    }
  };

  private _onSync = (isSynced: boolean) => {
    if (isSynced) {
      this._ready.resolve();
      this._yWebsocketProvider?.off('sync', this._onSync);
    }
  };

  private _awareness: Awareness;
  private _contentType: string;
  private _format: string;
  private _isDisposed: boolean;
  private _isFork: boolean;
  private _sessionId: string;
  private _path: string;
  private _ready = new PromiseDelegate<void>();
  private _serverUrl: string;
  private _sharedModel: YDocument<DocumentChange>;
  private _yWebsocketProvider: YWebsocketProvider | null;
  private _trans: TranslationBundle;
  private _user: User.IManager;
}

/**
 * A namespace for WebSocketProvider statics.
 */
export namespace WebSocketProvider {
  /**
   * The instantiation options for a WebSocketProvider.
   */
  export interface IOptions {
    /**
     * The server URL
     */
    url: string;

    /**
     * The document file path
     */
    path: string;

    /**
     * Content type
     */
    contentType: string;

    /**
     * The source format
     */
    format: string;

    /**
     * The shared model
     */
    model: YDocument<DocumentChange>;

    /**
     * The user data
     */
    user: User.IManager;

    /**
     * The jupyterlab translator
     */
    translator: TranslationBundle;

    /**
     * The document session ID, if the document is a fork
     */
    sessionId?: string;

    /**
     * Whether the document is a fork of a root document
     */
    isFork?: boolean;
  }
}

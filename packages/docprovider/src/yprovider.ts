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
import { IForkProvider } from './ydrive';

/**
 * A class to provide Yjs synchronization over WebSocket.
 *
 * We specify custom messages that the server can interpret. For reference please look in yjs_ws_server.
 *
 */

export class WebSocketProvider implements IDocumentProvider, IForkProvider {
  /**
   * Construct a new WebSocketProvider
   *
   * @param options The instantiation options for a WebSocketProvider
   */
  constructor(options: WebSocketProvider.IOptions) {
    this._isDisposed = false;
    this._sessionId = options.sessionId ?? '';
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
  get contentType(): string {
    return this._contentType;
  }

  get format(): string {
    return this._format;
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
    this._disconnect();
    Signal.clearData(this);
  }

  async reconnect(): Promise<void> {
    this._disconnect();
    this._connect();
  }

  async fork(): Promise<string> {
    const session = await requestDocSession(
      this._format,
      this._contentType,
      this._path
    );

    const response = await requestDocFork(`${session.format}:${session.type}:${session.fileId}`);
    const forkId = response.roomId;
    this._sharedModel.currentRoomId = forkId;
    this._sharedModel.addFork(forkId);

    return forkId;
  }

  connect(roomId: string, merge?: boolean) {
    this._sharedModel.currentRoomId = roomId;
    this._yWebsocketProvider?.disconnect();
    if (roomId === this._sharedModel.rootRoomId) {
      // connecting to the root
      // don't bring our changes there if not merging
      if (merge !== true) {
        while (this._sharedModel.undoManager.canUndo()) {
          this._sharedModel.undoManager.undo();
        }
      }
      this._sharedModel.undoManager.clear();
    }
    else {
      // connecting to a fork
      // keep track of changes so that we can undo them when connecting back to root
      this._sharedModel.undoManager.clear();
    }

    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      roomId,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params: { sessionId: this._sessionId },
        awareness: this._awareness
      }
    );
  }

  private async _connect(): Promise<void> {
    if (this._sharedModel.rootRoomId === '') {
      const session = await requestDocSession(
        this._format,
        this._contentType,
        this._path
      );
      this._sharedModel.rootRoomId = `${session.format}:${session.type}:${session.fileId}`;
      this._sharedModel.currentRoomId = this._sharedModel.rootRoomId;
      this._sessionId = session.sessionId;
    }

    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      this._sharedModel.rootRoomId,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params: { sessionId: this._sessionId },
        awareness: this._awareness
      }
    );

    this._yWebsocketProvider.on('sync', this._onSync);
    this._yWebsocketProvider.on('connection-close', this._onConnectionClosed);
  }

  async connectToForkDoc(forkRoomId: string, sessionId: string): Promise<void> {
    this._disconnect();
    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      forkRoomId,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params: { sessionId },
        awareness: this._awareness
      }
    );
  }

  get wsProvider() {
    return this._yWebsocketProvider;
  }
  private _disconnect(): void {
    this._yWebsocketProvider?.off('connection-close', this._onConnectionClosed);
    this._yWebsocketProvider?.off('sync', this._onSync);
    this._yWebsocketProvider?.destroy();
    this._yWebsocketProvider = null;
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
      if (this._yWebsocketProvider) {
        this._yWebsocketProvider.off('sync', this._onSync);

        const state = this._sharedModel.ydoc.getMap('state');
        state.set('document_id', this._yWebsocketProvider.roomname);
      }
      this._ready.resolve();
    }
  };

  private _awareness: Awareness;
  private _contentType: string;
  private _format: string;
  private _isDisposed: boolean;
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
  }
}

/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { showErrorMessage, Dialog } from '@jupyterlab/apputils';
import { User } from '@jupyterlab/services';
import { TranslationBundle } from '@jupyterlab/translation';

import { PromiseDelegate } from '@lumino/coreutils';
import { IDisposable } from '@lumino/disposable';
import { Signal } from '@lumino/signaling';

import { DocumentChange, YDocument } from '@jupyter/ydoc';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as url from 'lib0/url';
import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider as YWebsocketProvider } from 'y-websocket';

import { ISessionModel, requestDocSession } from './requests';
import { MessageType, RoomMessage } from './utils';

/**
 * An interface for a document provider.
 */
export interface IDocumentProvider extends IDisposable {
  /**
   * Returns a Promise that resolves when the document provider is ready.
   */
  readonly ready: Promise<void>;
}

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
    this._path = options.path;
    this._session = null;
    this._contentType = options.contentType;
    this._format = options.format;
    this._serverUrl = options.url;
    this._sharedModel = options.model;
    this._awareness = options.model.awareness;
    this._yWebsocketProvider = null;
    this._trans = options.translator;

    const user = options.user;

    user.ready
      .then(() => {
        this._onUserChanged(user);
      })
      .catch(e => console.error(e));
    user.userChanged.connect(this._onUserChanged, this);

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

  private async _connect(): Promise<void> {
    this._session = await requestDocSession(
      this._format,
      this._contentType,
      this._path
    );

    const params =
      this._session.sessionId !== null
        ? { sessionId: this._session.sessionId }
        : undefined;

    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      `${this._session.format}:${this._session.type}:${this._session.fileId}`,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params,
        awareness: this._awareness
      }
    );

    this._yWebsocketProvider.on('sync', this._onSync);
    this._yWebsocketProvider.on('connection-close', this._onConnectionClosed);

    this._yWebsocketProvider.messageHandlers[MessageType.ROOM] = (
      encoder,
      decoder,
      provider,
      emitSynced,
      messageType
    ) => {
      const msgType = decoding.readVarUint(decoder);
      const data = decoding.readVarString(decoder);
      this._handleRoomMessage(msgType, data);
    };
  }

  private _onUserChanged(user: User.IManager): void {
    this._awareness.setLocalStateField('user', user.identity);
  }

  private _onConnectionClosed = (event: any): void => {
    if (event.code >= 4000 && event.code < 4005) {
      console.error('Document provider closed:', event.code, event.reason);

      showErrorMessage(this._trans.__('Document error'), event.reason, [
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

  private _handleRoomMessage(type: number, data: string): void {
    switch (type) {
      case RoomMessage.FILE_CHANGED:
        this._handleFileChanged(data);
        break;

      case RoomMessage.DOC_OVERWRITTEN:
      case RoomMessage.FILE_OVERWRITTEN:
        if (this._dialog) {
          this._dialog.close();
          this._dialog = null;
        }
        break;
      case RoomMessage.SESSION_TOKEN:
        this._handleSessionToken(data);
        break;
    }
  }

  private _handleFileChanged(data: string): void {
    this._dialog = new Dialog({
      title: this._trans.__('File changed'),
      body: this._trans.__('Do you want to overwrite the file or reload it?'),
      buttons: [
        Dialog.okButton({ label: 'Reload' }),
        Dialog.warnButton({ label: 'Overwrite' })
      ],
      hasClose: false
    });

    this._dialog.launch().then(resp => {
      if (resp.button.label === 'Reload') {
        this._sendReloadMsg(data);
      } else if (resp.button.label === 'Overwrite') {
        this._sendOverwriteMsg(data);
      }
    });
  }

  private _handleSessionToken(data: string): void {
    if (this._yWebsocketProvider && this._session) {
      const room = `${this._session.format}:${this._session.type}:${this._session.fileId}`;
      const encodedParams = url.encodeQueryParams({ sessionId: data });
      this._yWebsocketProvider.url =
        this._serverUrl + '/' + room + '?' + encodedParams;
    }
  }

  private _sendReloadMsg(data: string): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.ROOM);
    encoding.writeVarUint(encoder, RoomMessage.RELOAD);
    encoding.writeVarString(encoder, data);
    this._yWebsocketProvider?.ws!.send(encoding.toUint8Array(encoder));
  }

  private _sendOverwriteMsg(data: string): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MessageType.ROOM);
    encoding.writeVarUint(encoder, RoomMessage.OVERWRITE);
    encoding.writeVarString(encoder, data);
    this._yWebsocketProvider?.ws!.send(encoding.toUint8Array(encoder));
  }

  private _dialog: Dialog<any> | null = null;
  private _awareness: Awareness;
  private _contentType: string;
  private _format: string;
  private _isDisposed: boolean;
  private _path: string;
  private _session: ISessionModel | null;
  private _ready = new PromiseDelegate<void>();
  private _serverUrl: string;
  private _sharedModel: YDocument<DocumentChange>;
  private _yWebsocketProvider: YWebsocketProvider | null;
  private _trans: TranslationBundle;
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
  }
}

/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { IDocumentProvider } from '@jupyter/collaborative-drive';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { ServerConnection, User } from '@jupyterlab/services';
import { TranslationBundle } from '@jupyterlab/translation';

import { PromiseDelegate } from '@lumino/coreutils';
import { Signal } from '@lumino/signaling';

import { DocumentChange, YDocument } from '@jupyter/ydoc';

import { Awareness } from 'y-protocols/awareness';
import { WebsocketProvider as YWebsocketProvider } from 'y-websocket';

import { requestDocSession } from './requests';
import { IForkProvider } from './ydrive';
import { URLExt } from '@jupyterlab/coreutils';
import { ISessionClosePayload } from './tokens';

/**
 * The url for the default drive service.
 */
const DOCUMENT_PROVIDER_URL = 'api/collaboration/room';

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
    this._path = options.path;
    this._contentType = options.contentType;
    this._format = options.format;
    this._customServerUrl = options.url;
    this._sharedModel = options.model;
    this._awareness = options.model.awareness;
    this._yWebsocketProvider = null;
    this._serverSettings =
      options.serverSettings ?? ServerConnection.makeSettings();
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

  private get _serverUrl() {
    return (
      this._customServerUrl ??
      URLExt.join(this._serverSettings.wsUrl, DOCUMENT_PROVIDER_URL)
    );
  }

  private async _connect(): Promise<void> {
    const session = await requestDocSession(
      this._format,
      this._contentType,
      this._path,
      this._serverSettings
    );
    const token = this._serverSettings.token;
    const params: Record<string, string> = { sessionId: session.sessionId };
    if (this._serverSettings.appendToken && token !== '') {
      params['token'] = token;
    }

    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      `${session.format}:${session.type}:${session.fileId}`,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params,
        awareness: this._awareness,
        WebSocketPolyfill: this._serverSettings.WebSocket
      }
    );

    this._yWebsocketProvider.on('sync', this._onSync);
    this._yWebsocketProvider.on('connection-close', this._onConnectionClosed);
  }

  async connectToForkDoc(forkRoomId: string, sessionId: string): Promise<void> {
    const token = this._serverSettings.token;
    const params: Record<string, string> = { sessionId };
    if (this._serverSettings.appendToken && token !== '') {
      params['token'] = token;
    }
    this._disconnect();
    this._yWebsocketProvider = new YWebsocketProvider(
      this._serverUrl,
      forkRoomId,
      this._sharedModel.ydoc,
      {
        disableBc: true,
        params,
        awareness: this._awareness,
        WebSocketPolyfill: this._serverSettings.WebSocket
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

  private _buildSessionExpiredMessage(
    payload: ISessionClosePayload,
    trans: TranslationBundle
  ): { title: string; body: string } {
    switch (payload.reason) {
      case 'version_mismatch':
        return {
          title: trans.__('Collaboration extension updated'),
          body: trans.__('Reload the browser tab to load the new version.')
        };
      case 'initialization_error':
        return {
          title: trans.__('Document error'),
          body: trans.__(
            'Failed to initialize the document. Close this tab and reopen the file.'
          )
        };
      case 'unknown_session':
      default:
        return {
          title: trans.__('Session expired'),
          body: payload.errorReason
            ? trans.__(payload.errorReason)
            : trans.__('Reload the browser tab to continue.')
        };
    }
  }

  private _onConnectionClosed = async (event: CloseEvent): Promise<void> => {
    if ([4400, 4404, 4500].includes(event.code)) {
      if (!this._hasSynced) {
        // Rejecting the ready promise will close the file placeholder widget.
        const reason = this._getCloseReasonMessage(
          event.code as 4400 | 4404 | 4500
        );
        this._ready.reject(reason);
        // Disposing model prevents repeated websocket reconnection attempts.
        // Rejecting the ready promise will ultimately close the file,
        // but the document manager takes some time to do so.
        this._sharedModel.dispose();
      }
    }
    if (event.code === 1003) {
      console.error('Document provider closed:', event.reason);

      let payload: ISessionClosePayload;
      try {
        payload = JSON.parse(event.reason) as ISessionClosePayload;
      } catch {
        payload = {
          reason: 'unknown_session',
          sessionId: '',
          reloadable: false,
          errorReason: event.reason
        };
      }

      const { title, body } = this._buildSessionExpiredMessage(
        payload,
        this._trans
      );

      const result = await showDialog({
        title,
        body,
        buttons: payload.reloadable
          ? [
              Dialog.cancelButton({ label: this._trans.__('Continue') }),
              Dialog.okButton({ label: this._trans.__('Reload') })
            ]
          : [Dialog.okButton({ label: this._trans.__('Ok') })]
      });

      if (result.button.accept && payload.reloadable) {
        window.location.reload();
      }
      // Dispose shared model immediately. Better break the document model,
      // than overriding data on disk.
      this._sharedModel.dispose();
    }
  };

  private _onSync = (isSynced: boolean) => {
    if (isSynced) {
      this._hasSynced = true;
      if (this._yWebsocketProvider) {
        this._yWebsocketProvider.off('sync', this._onSync);

        const state = this._sharedModel.ydoc.getMap('state');
        state.set('document_id', this._yWebsocketProvider.roomname);
      }
      this._ready.resolve();
    }
  };

  private _getCloseReasonMessage(code: 4400 | 4404 | 4500): string {
    switch (code) {
      case 4400: {
        return this._trans.__('Bad request for %1', this._path);
      }
      case 4404: {
        return this._trans.__('Could not find %1', this._path);
      }
      case 4500: {
        return this._trans.__(
          'Internal server error when loading %1',
          this._path
        );
      }
    }
  }

  private _awareness: Awareness;
  private _contentType: string;
  private _format: string;
  private _isDisposed: boolean;
  private _path: string;
  private _ready = new PromiseDelegate<void>();
  private _customServerUrl?: string;
  private _sharedModel: YDocument<DocumentChange>;
  private _yWebsocketProvider: YWebsocketProvider | null;
  private _serverSettings: ServerConnection.ISettings;
  private _trans: TranslationBundle;
  private _hasSynced = false;
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
    url?: string;

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
     * The server settings.
     */
    serverSettings?: ServerConnection.ISettings;
  }
}

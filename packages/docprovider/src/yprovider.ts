/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { WebsocketProvider as YWebsocketProvider } from 'y-websocket';
import { Awareness } from 'y-protocols/awareness';

import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { ISignal, Signal } from '@lumino/signaling';
import { JSONValue, PromiseDelegate } from '@lumino/coreutils';

import { DocumentChange, YDocument } from '@jupyter/ydoc';
import { IDocumentProvider } from '@jupyter/collaborative-drive';

import { ServerConnection, User } from '@jupyterlab/services';
import { URLExt } from '@jupyterlab/coreutils';
import { TranslationBundle } from '@jupyterlab/translation';
import { Dialog, showDialog } from '@jupyterlab/apputils';

import { IForkProvider } from './ydrive';
import {
  requestDocSession,
  requestDocumentContent,
  IContentsModel
} from './requests';
import {
  applyContent,
  clearForAdoption,
  contentsEqual,
  reassertAuthoritativeState,
  removePlaceholderCell,
  settledOnBase
} from './rebase';
import { ISessionClosePayload } from './tokens';

/**
 * The url for the default drive service.
 */
const DOCUMENT_PROVIDER_URL = 'api/collaboration/room';

/**
 * The raw message type.
 */
const RAW_MESSAGE_TYPE = 2;

/**
 * How long to wait for the newly adopted session content to settle on the
 * expected base before re-applying local edits on top of it (this needs to
 * accommodate progressive loading of large documents).
 */
const REBASE_SETTLE_TIMEOUT = 30 * 1000;

/**
 * How many times the reconciliation decision is re-taken when the room's
 * document session keeps rolling under us (e.g. a file being rewritten
 * repeatedly by an external tool) before handing the decision to the user.
 */
const MAX_REBASE_ATTEMPTS = 5;

/**
 * The outcome of an attempt to join a room on a new document session.
 */
type AdoptOutcome =
  | { status: 'synced' }
  | { status: 'rolled'; sessionId: string }
  | { status: 'failed'; error?: unknown }
  | { status: 'disposed' };

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
    this._onConflictSaveAs = options.onConflictSaveAs;
    this._onConflictRevert = options.onConflictRevert;
    this._onConflictShowDiff = options.onConflictShowDiff;

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
    this._stopConvergenceWatch();
    this._setPendingConflict(null);
    // Wake up anything waiting inside a reconciliation; `isDisposed` is
    // already set, so each waiter reports a disposal rather than mistaking
    // this for a successful synchronization.
    this._pendingRoll = null;
    for (const listener of Array.from(this._rollListeners)) {
      listener();
    }
    this._rollListeners.clear();
    if (this._conflictWs) {
      this._conflictWs.removeEventListener(
        'message',
        this._handleConflictMessage
      );
      this._conflictWs = null;
    }
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

  async save(): Promise<void> {
    const ws = this._yWebsocketProvider?.ws;
    if (!ws && (this._pendingConflict !== null || this._rebasing)) {
      // Saving goes through the room; while the document is held back from
      // collaboration there is nothing to save through. Resolving here would
      // report a successful save for content that never left the browser.
      throw new Error(
        this._trans.__(
          'Cannot save %1 while the document conflict is unresolved.',
          this._path
        )
      );
    }
    if (ws) {
      const saveId = ++this._saveCounter;
      const delegate = new PromiseDelegate<void>();
      const handler = (event: MessageEvent) => {
        const data = new Uint8Array(event.data);
        const decoder = decoding.createDecoder(data);
        try {
          const messageType = decoding.readVarUint(decoder);
          if (messageType !== RAW_MESSAGE_TYPE) {
            return;
          }
        } catch {
          return;
        }
        const rawReply = decoding.readVarString(decoder);
        let reply: {
          type: 'save';
          responseTo: number;
          status: 'success' | 'skipped' | 'failed';
        } | null = null;
        try {
          reply = JSON.parse(rawReply);
        } catch (e) {
          console.debug('The raw reply received was not a JSON reply');
        }
        if (
          reply &&
          reply['type'] === 'save' &&
          reply['responseTo'] === saveId
        ) {
          if (reply.status === 'success') {
            delegate.resolve();
          } else if (reply.status === 'failed') {
            delegate.reject('Saving failed');
          } else if (reply.status === 'skipped') {
            delegate.reject('Saving already in progress');
          } else {
            delegate.reject('Unrecognised save reply status');
          }
        }
      };
      ws.addEventListener('message', handler);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, RAW_MESSAGE_TYPE);
      encoding.writeVarString(encoder, 'save');
      encoding.writeVarUint(encoder, saveId);
      const saveMessage = encoding.toUint8Array(encoder);
      ws.send(saveMessage);
      try {
        await delegate.promise;
      } finally {
        ws.removeEventListener('message', handler);
      }
    }
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
    if (!this._docSessionId && session.documentSessionId) {
      this._docSessionId = session.documentSessionId;
    }
    const token = this._serverSettings.token;
    const params: Record<string, string> = { sessionId: session.sessionId };
    if (this._docSessionId) {
      // Claim the document session our local Yjs history belongs to; the
      // server refuses the connection (before any sync message) if the room
      // is on a different session, i.e. its history diverged from ours.
      params['docSessionId'] = this._docSessionId;
    }
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
    this._yWebsocketProvider.on('status', ({ status }: { status: string }) => {
      if (status === 'connected') {
        this._attachConflictListener();
      }
    });
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

      if (payload.reason === 'session_changed') {
        // The room's Yjs history diverged from the local document (e.g. the
        // room was rebuilt from a changed file, or the YStore was lost).
        // Never resynchronize blindly: reconcile the local content first.
        void this._onSessionChanged(payload.sessionId ?? '');
        return;
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

  private _attachConflictListener(): void {
    if (this._conflictWs) {
      this._conflictWs.removeEventListener(
        'message',
        this._handleConflictMessage
      );
    }
    const ws = this._yWebsocketProvider?.ws;
    if (ws) {
      ws.addEventListener('message', this._handleConflictMessage);
      this._conflictWs = ws;
    }
  }

  private _handleConflictMessage = async (
    event: MessageEvent
  ): Promise<void> => {
    if (!(event.data instanceof ArrayBuffer)) {
      return;
    }
    const data = new Uint8Array(event.data);
    if (data.length === 0) {
      return;
    }
    const decoder = decoding.createDecoder(data);
    try {
      if (decoding.readVarUint(decoder) !== RAW_MESSAGE_TYPE) {
        return;
      }
      const payload = JSON.parse(decoding.readVarString(decoder));
      if (!payload || payload.type !== 'conflict') {
        return;
      }
    } catch {
      return;
    }
    await this._showConflictDialog(
      this._sharedModel.getSource(),
      this._onConflictRevert
    );
  };

  /**
   * Show the "Edit Conflict" dialog.
   *
   * @param localContent - The local content at conflict time, passed to
   *   the diff view.
   * @param onRevert - The action performed when the user chooses "Revert".
   */
  private async _showConflictDialog(
    localContent: JSONValue,
    onRevert?: () => Promise<void>
  ): Promise<void> {
    const buttons: Dialog.IButton[] = [
      Dialog.cancelButton({ label: this._trans.__('Dismiss') })
    ];
    if (onRevert) {
      buttons.push(
        Dialog.warnButton({
          label: this._trans.__('Revert'),
          actions: ['revert']
        })
      );
    }
    if (this._onConflictShowDiff) {
      buttons.push(
        Dialog.okButton({
          label: this._trans.__('Show Diff'),
          actions: ['show-diff']
        })
      );
    }
    if (this._onConflictSaveAs) {
      buttons.push(
        Dialog.okButton({
          label: this._trans.__('Save As'),
          actions: ['save-as']
        })
      );
    }
    const result = await showDialog({
      title: this._trans.__('Edit Conflict'),
      body: this._trans.__(
        'Your recent changes could not be applied because the document ' +
          'structure changed while you were disconnected (for example, another ' +
          'user or external tool modified the file). Your edits were not ' +
          'saved to the shared document.'
      ),
      buttons
    });
    if (result.button.actions.includes('revert')) {
      await onRevert?.();
    } else if (result.button.actions.includes('show-diff')) {
      await this._onConflictShowDiff?.(
        localContent,
        onRevert ? { revert: onRevert } : undefined
      );
    } else if (result.button.actions.includes('save-as')) {
      await this._onConflictSaveAs?.();
    }
  }

  /**
   * Handle the server refusing our connection because the document session
   * changed: the room's Yjs history diverged from the local document.
   *
   * @param newSessionId - The document session the room is now on.
   *
   * #### Notes
   * Implements the reconciliation strategy of
   * https://github.com/jupyterlab/jupyter-collaboration/issues/597:
   * - a document that never synchronized simply adopts the new session;
   * - identical content: silently discard the local Yjs history and rejoin;
   * - no unsaved local changes: likewise, catching up to the server content;
   * - unsaved local changes on top of an unchanged file: rejoin and re-apply
   *   the local content as fresh edits (semantic rebase);
   * - anything else is a real conflict: show the "Edit Conflict" dialog.
   */
  private async _onSessionChanged(newSessionId: string): Promise<void> {
    if (this.isDisposed) {
      return;
    }
    if (!newSessionId) {
      // The server always reports the session it moved to; without one there
      // is nothing to claim, and reconnecting would only be refused again.
      console.error(
        `Document session of '${this._path}' changed but the server did not ` +
          `report the new session: staying disconnected`
      );
      this._disconnect();
      return;
    }
    if (this._rebasing) {
      // A reconciliation is already running: make it re-take its decision
      // against this newer session rather than racing a second one.
      this._noteRoll(newSessionId);
      return;
    }
    this._rebasing = true;
    try {
      // Stop Yjs-level reconnection attempts immediately: we must not
      // exchange sync messages with a room holding a diverged history.
      this._disconnect();
      if (!this._hasSynced) {
        // Nothing local to preserve (e.g. the session rolled between the
        // REST handshake and the websocket connection of a fresh document):
        // adopt the new session and reconnect.
        console.log(
          `Document session of '${this._path}' changed before the first ` +
            `synchronization: reconnecting to session ${newSessionId}`
        );
        this._docSessionId = newSessionId;
        await this._connect();
        return;
      }
      // Captured once: an attempt which gets refused mid-adoption has
      // already emptied the document, so re-reading it per attempt would
      // have the next decision taken on (and later applied as) nothing.
      const snapshot = this._sharedModel.getSource();
      let target: string | null = newSessionId;
      let attempt = 0;
      while (target !== null && attempt < MAX_REBASE_ATTEMPTS) {
        attempt++;
        this._pendingRoll = null;
        const restart = await this._reconcile(target, snapshot);
        target = restart ? this._pendingRoll : null;
      }
      if (target !== null) {
        // The room's history kept moving while we reconciled; stop guessing
        // and let the user decide what to keep.
        console.warn(
          `Document session of '${this._path}' rolled ${attempt} times ` +
            `during reconciliation: asking the user to resolve`
        );
        await this._enterConflict(snapshot, target);
      }
    } catch (error) {
      console.error('Failed to handle a document session change', error);
    } finally {
      this._rebasing = false;
      this._pendingRoll = null;
    }
  }

  /**
   * Whether content holds nothing worth preserving.
   *
   * @param content - The content to inspect.
   * @returns Whether the content is empty.
   */
  private _isEmptyContent(content: JSONValue): boolean {
    if (this._contentType === 'notebook') {
      const cells = (content as any)?.cells;
      return !Array.isArray(cells) || cells.length === 0;
    }
    return content === '' || content === null || content === undefined;
  }

  /**
   * Adopt a session on the user's behalf, following the room if it rolls
   * again, and putting the local content back if it cannot be joined.
   *
   * @param sessionId - The document session to adopt.
   * @param fallback - The local content to restore on failure.
   * @param server - The server content, to restore authoritative values.
   * @returns Whether the document ended up joined to the room.
   *
   * #### Notes
   * Used by the resolutions the user triggers directly ("Revert", and the
   * automatic rejoin once the content converged), which - unlike
   * {@link _reconcile} - do not re-take a decision: the user already made
   * it. Owns the roll bookkeeping for those paths, so that a roll observed
   * here can never leak into a later reconciliation.
   */
  private async _adoptFollowingRolls(
    sessionId: string,
    fallback: JSONValue,
    server: IContentsModel | null
  ): Promise<boolean> {
    let target = sessionId;
    try {
      for (let attempt = 0; attempt < MAX_REBASE_ATTEMPTS; attempt++) {
        this._pendingRoll = null;
        const outcome = await this._adoptSession(target);
        if (outcome.status === 'synced') {
          if (server) {
            reassertAuthoritativeState(
              this._sharedModel,
              server.content,
              server.hash ?? null,
              this._contentType
            );
          }
          return true;
        }
        if (outcome.status === 'disposed' || this.isDisposed) {
          return false;
        }
        if (outcome.status === 'failed') {
          break;
        }
        target = outcome.sessionId;
        applyContent(this._sharedModel, fallback, this._contentType);
      }
      console.error(
        `Could not join '${this._path}' on session ${target}; restoring the ` +
          `local content and leaving the conflict unresolved`
      );
      applyContent(this._sharedModel, fallback, this._contentType);
      this._setPendingConflict({
        localContent: fallback,
        newSessionId: target,
        server
      });
      return false;
    } finally {
      this._pendingRoll = null;
    }
  }

  /**
   * Record that the room moved to another document session while a
   * reconciliation was in flight, and wake up whatever the reconciliation
   * is currently waiting for.
   *
   * @param sessionId - The document session the room is now on.
   */
  private _noteRoll(sessionId: string): void {
    this._pendingRoll = sessionId;
    for (const listener of Array.from(this._rollListeners)) {
      listener();
    }
  }

  /**
   * Take (or re-take) the reconciliation decision for a diverged session.
   *
   * @param newSessionId - The document session the room is on.
   * @returns Whether the decision must be re-taken because the room moved
   *   to yet another session in the meantime.
   *
   * #### Notes
   * The decision matrix, in order (see
   * https://github.com/jupyterlab/jupyter-collaboration/issues/597):
   * - identical content: silently discard the local Yjs history and rejoin;
   * - no unsaved local changes: likewise, catching up to the server content;
   * - unsaved local changes on top of an unchanged file: rejoin and re-apply
   *   the local content as fresh edits (semantic rebase);
   * - anything else is a real conflict: let the user choose.
   *
   * Every step which can observe a stale premise re-checks it: the room may
   * roll again, another client may edit the rebuilt room, and the user keeps
   * typing throughout. Whenever a premise no longer holds, the flow either
   * restarts or falls through to the conflict dialog - it never applies
   * content decided on stale grounds.
   */
  private async _reconcile(
    newSessionId: string,
    localContent: JSONValue
  ): Promise<boolean> {
    let server: IContentsModel;
    try {
      server = await requestDocumentContent(
        this._path,
        this._format,
        this._contentType,
        this._serverSettings
      );
    } catch (error) {
      console.error(
        'Could not fetch the server content for conflict resolution',
        error
      );
      await this._enterConflict(localContent, newSessionId);
      return false;
    }
    if (this._pendingRoll !== null) {
      return true;
    }

    if (contentsEqual(localContent, server.content, this._contentType)) {
      // (e) The content is identical: only the Yjs history differs.
      console.log(
        `Document session of '${this._path}' changed but the content is ` +
          `identical: silently rejoining on session ${newSessionId}`
      );
      return this._catchUp(newSessionId, server, localContent);
    }

    if (this._sharedModel.dirty !== true) {
      // The local document has no unsaved changes: catch up to the server
      // content (e.g. the file changed while this client was disconnected).
      console.log(
        `Document session of '${this._path}' changed and there are no ` +
          `unsaved local changes: catching up to the server content on ` +
          `session ${newSessionId}`
      );
      return this._catchUp(newSessionId, server, localContent);
    }

    const lastSavedHash = this._sharedModel.getState('hash');
    if (
      server.hash &&
      typeof lastSavedHash === 'string' &&
      server.hash === lastSavedHash
    ) {
      // (f) The file did not change since the last save this client knows
      // of: the only difference between local and server content are our
      // own unsaved edits. Rejoin the new session and re-apply them on top.
      console.log(
        `Document session of '${this._path}' changed but the file did not ` +
          `change since the last known save: rejoining on session ` +
          `${newSessionId} and re-applying unsaved local edits`
      );
      return this._semanticRebase(newSessionId, server, localContent);
    }

    // (g) Both the file and the local document changed: a real conflict.
    await this._enterConflict(localContent, newSessionId, server);
    if (this._pendingConflict) {
      // The conflict was left unresolved (Dismiss, Save As, or an unapplied
      // diff view): watch for the local content converging to the server
      // content (e.g. through "Revert to Remote" in the diff view, or the
      // user manually undoing their conflicting edits): once equal, the
      // document can rejoin the new session without any data loss.
      this._watchForConvergence(server, newSessionId);
    }
    return false;
  }

  /**
   * Discard the local history and take the room content as it is.
   *
   * @param newSessionId - The document session to adopt.
   * @param server - The server content, used to restore authoritative
   *   values the adoption cannot carry over.
   * @param fallback - The local content to restore if the adoption fails.
   * @returns Whether the reconciliation decision must be re-taken.
   */
  private async _catchUp(
    newSessionId: string,
    server: IContentsModel,
    fallback: JSONValue
  ): Promise<boolean> {
    const outcome = await this._adoptSession(newSessionId);
    if (outcome.status !== 'synced') {
      return this._handleFailedAdoption(outcome, fallback, newSessionId);
    }
    reassertAuthoritativeState(
      this._sharedModel,
      server.content,
      server.hash ?? null,
      this._contentType
    );
    this._sharedModel.dirty = false;
    return false;
  }

  /**
   * Rejoin the room and re-apply the unsaved local edits on top of it.
   *
   * @param newSessionId - The document session to adopt.
   * @param server - The server content the room is expected to hold.
   * @param fallback - The content to re-apply if the document turns out to
   *   hold nothing to capture.
   * @returns Whether the reconciliation decision must be re-taken.
   */
  private async _semanticRebase(
    newSessionId: string,
    server: IContentsModel,
    fallback: JSONValue
  ): Promise<boolean> {
    // Captured on the statement before the adoption clears the document, so
    // that edits typed while the server content was being fetched are part
    // of what gets re-applied rather than silently dropped.
    const captured = this._sharedModel.getSource();
    const localContent = this._isEmptyContent(captured) ? fallback : captured;
    const outcome = await this._adoptSession(newSessionId);
    if (outcome.status !== 'synced') {
      return this._handleFailedAdoption(outcome, localContent, newSessionId);
    }

    const settled = await this._waitUntilSettled(server.content);
    if (settled === 'rolled') {
      return true;
    }
    if (
      settled === 'timeout' ||
      !contentsEqual(
        this._sharedModel.getSource(),
        server.content,
        this._contentType
      )
    ) {
      // Either the room never finished delivering the content we expected,
      // or it no longer holds it (another client edited the rebuilt room).
      // Re-applying our snapshot wholesale would delete their work, so the
      // user decides instead.
      console.warn(
        `Could not re-apply the unsaved edits of '${this._path}' on top of ` +
          `session ${newSessionId} (${settled}): asking the user to resolve`
      );
      await this._enterConflict(localContent, newSessionId, server);
      return false;
    }
    applyContent(this._sharedModel, localContent, this._contentType);
    return false;
  }

  /**
   * Deal with an adoption that did not end up synchronized.
   *
   * @param outcome - The outcome of the adoption.
   * @param fallback - The local content captured before the adoption
   *   cleared the document.
   * @param sessionId - The document session which was being adopted.
   * @returns Whether the reconciliation decision must be re-taken.
   */
  private async _handleFailedAdoption(
    outcome: AdoptOutcome,
    fallback: JSONValue,
    sessionId: string
  ): Promise<boolean> {
    if (outcome.status === 'rolled') {
      // The adoption already emptied the document. Put the content back
      // before retrying, so the next decision is taken on the user's work
      // rather than on the nothing this attempt left behind.
      if (!this.isDisposed) {
        applyContent(this._sharedModel, fallback, this._contentType);
      }
      this._noteRoll(outcome.sessionId);
      return true;
    }
    if (outcome.status !== 'failed' || this.isDisposed) {
      return false;
    }
    // The adoption cleared the document but never joined the room. Put the
    // local content back so the user still sees (and can save) their work,
    // and surface that collaboration is paused.
    console.error(
      `Could not join '${this._path}' on session ${sessionId}; restoring ` +
        `the local content and pausing collaboration`,
      outcome.error
    );
    applyContent(this._sharedModel, fallback, this._contentType);
    await this._enterConflict(fallback, sessionId);
    return false;
  }

  /**
   * Enter the unresolved-conflict state and offer the user a resolution.
   *
   * @param localContent - The local content at conflict time.
   * @param newSessionId - The document session to rejoin on resolution.
   * @param server - The server content, when it is known, so that resolving
   *   the conflict can restore the authoritative values which adopting a
   *   session cannot carry over (see {@link reassertAuthoritativeState}).
   */
  private async _enterConflict(
    localContent: JSONValue,
    newSessionId: string,
    server: IContentsModel | null = null
  ): Promise<void> {
    this._setPendingConflict({ localContent, newSessionId, server });
    // The reconciliation is parked here until the user decides, so the
    // resolution they pick is allowed to take over the connection even
    // though a reconciliation is nominally still in progress.
    const wasAwaiting = this._awaitingUserResolution;
    this._awaitingUserResolution = true;
    try {
      await this.showConflictDialog();
    } finally {
      this._awaitingUserResolution = wasAwaiting;
    }
  }

  /**
   * Whether the document has an unresolved edit conflict: it is
   * disconnected from collaboration and local changes are not shared.
   */
  get hasUnresolvedConflict(): boolean {
    return this._pendingConflict !== null;
  }

  /**
   * A signal emitting when the document enters (`true`) or leaves (`false`)
   * the unresolved-conflict state.
   */
  get conflictStateChanged(): ISignal<this, boolean> {
    return this._conflictStateChanged;
  }

  /**
   * Show the "Edit Conflict" dialog for the pending conflict, allowing the
   * user to resolve it (e.g. after having previously dismissed it).
   *
   * #### Notes
   * No-op when there is no pending conflict.
   */
  async showConflictDialog(): Promise<void> {
    const pending = this._pendingConflict;
    if (!pending) {
      return;
    }
    await this._showConflictDialog(pending.localContent, async () => {
      if (this._pendingConflict !== pending || this.isDisposed) {
        // The conflict this dialog belongs to is gone (resolved by the
        // convergence watch, superseded by a newer one, or the document was
        // closed). Adopting now would clear a document which is once again
        // live and shared, deleting the content for every collaborator.
        return;
      }
      if (this._rebasing && !this._awaitingUserResolution) {
        // A reconciliation is actively working on the connection; only one
        // of the two may drive it. (A reconciliation parked on this very
        // dialog does not count: it is waiting for exactly this answer.)
        return;
      }
      this._rebasing = true;
      try {
        const joined = await this._adoptFollowingRolls(
          pending.newSessionId,
          pending.localContent,
          pending.server
        );
        if (!joined) {
          return;
        }
        this._sharedModel.dirty = false;
        this._stopConvergenceWatch();
        this._setPendingConflict(null);
      } finally {
        this._rebasing = false;
      }
    });
  }

  private _setPendingConflict(
    pending: {
      localContent: JSONValue;
      newSessionId: string;
      server: IContentsModel | null;
    } | null
  ): void {
    const wasPending = this._pendingConflict !== null;
    this._pendingConflict = pending;
    const isPending = pending !== null;
    if (wasPending !== isPending) {
      this._conflictStateChanged.emit(isPending);
    }
  }

  /**
   * Discard the local Yjs history and rejoin the room on its new session.
   *
   * All ordered content is tombstoned in a single transaction, so that the
   * subsequent synchronization pushes only tombstones of items the new
   * lineage never had (a no-op for the server room) while pulling the whole
   * room content. Content-addressed rebuild client ids on the server
   * guarantee the two lineages never overlap on Yjs coordinates.
   *
   * @param newSessionId - The document session to adopt.
   */
  private async _adoptSession(newSessionId: string): Promise<AdoptOutcome> {
    const placeholderId = clearForAdoption(
      this._sharedModel,
      this._contentType,
      this
    );
    try {
      this._sharedModel.undoManager.clear();
    } catch {
      // The undo manager may not cover this document type.
    }
    try {
      return await this._joinSession(newSessionId);
    } finally {
      if (placeholderId) {
        removePlaceholderCell(this._sharedModel, placeholderId);
      }
    }
  }

  /**
   * Connect claiming the given document session and wait for the outcome.
   *
   * @param newSessionId - The document session to claim.
   * @returns How the attempt ended.
   */
  private async _joinSession(newSessionId: string): Promise<AdoptOutcome> {
    this._disconnect();
    this._docSessionId = newSessionId;
    try {
      await this._connect();
    } catch (error) {
      return { status: 'failed', error };
    }
    if (this.isDisposed) {
      return { status: 'disposed' };
    }
    const provider = this._yWebsocketProvider;
    if (!provider) {
      return { status: 'failed' };
    }
    return await new Promise<AdoptOutcome>(resolve => {
      // Hoisted so that the listeners below can settle the race, and it can
      // unregister them in turn.
      function settle(this: void, outcome: AdoptOutcome): void {
        provider!.off('sync', onSync);
        provider!.off('connection-close', onClose);
        rollListeners.delete(onRoll);
        resolve(isDisposed() ? { status: 'disposed' } : outcome);
      }
      const rollListeners = this._rollListeners;
      const isDisposed = () => this.isDisposed;
      const onSync = (isSynced: boolean) => {
        if (isSynced) {
          settle({ status: 'synced' });
        }
      };
      const onClose = (event: CloseEvent) => {
        // A refusal is reported through `_noteRoll`; these are the terminal
        // closures, which would otherwise leave the race pending forever.
        if ([4400, 4404, 4500].includes(event.code)) {
          settle({ status: 'failed', error: event.reason });
        }
      };
      const onRoll = () => {
        const rolled = this._pendingRoll;
        settle(
          rolled !== null
            ? { status: 'rolled', sessionId: rolled }
            : { status: 'disposed' }
        );
      };
      provider.on('sync', onSync);
      provider.on('connection-close', onClose);
      this._rollListeners.add(onRoll);
      if (this.isDisposed) {
        settle({ status: 'disposed' });
      } else if (this._pendingRoll !== null) {
        // The room rolled again between connecting and arming the listener.
        onRoll();
      }
    });
  }

  /**
   * Wait until the shared document has settled on the given base content,
   * i.e. the initial synchronization (including progressive loading of
   * large documents) delivered the room content, before re-applying local
   * edits on top of it.
   *
   * @param baseContent - The content the document is expected to settle on.
   */
  private async _waitUntilSettled(
    baseContent: unknown
  ): Promise<'settled' | 'timeout' | 'rolled'> {
    if (
      settledOnBase(
        this._sharedModel.getSource(),
        baseContent,
        this._contentType
      )
    ) {
      return 'settled';
    }
    return await new Promise<'settled' | 'timeout' | 'rolled'>(resolve => {
      let timer: number | null = null;
      const finish = (result: 'settled' | 'timeout' | 'rolled') => {
        this._sharedModel.changed.disconnect(onChange);
        this._rollListeners.delete(onRoll);
        if (timer !== null) {
          clearTimeout(timer);
        }
        resolve(result);
      };
      const onChange = () => {
        if (
          settledOnBase(
            this._sharedModel.getSource(),
            baseContent,
            this._contentType
          )
        ) {
          finish('settled');
        }
      };
      const onRoll = () => finish('rolled');
      this._sharedModel.changed.connect(onChange);
      this._rollListeners.add(onRoll);
      // The timeout is reported rather than treated as success: the caller
      // must not apply content on top of a document which never finished
      // loading (it would duplicate the cells still on their way).
      timer = window.setTimeout(() => finish('timeout'), REBASE_SETTLE_TIMEOUT);
      onChange();
    });
  }

  /**
   * After an unresolved conflict, watch the local document: if its content
   * converges to the server content (through the diff view actions or
   * manual edits), rejoin the new session automatically.
   *
   * @param server - The server content the local document may converge to.
   * @param newSessionId - The document session to adopt on convergence.
   */
  private _watchForConvergence(
    server: IContentsModel,
    newSessionId: string
  ): void {
    this._stopConvergenceWatch();
    let debounce: number | null = null;
    const onChange = () => {
      if (debounce !== null) {
        clearTimeout(debounce);
      }
      debounce = window.setTimeout(() => {
        if (this.isDisposed || this._rebasing) {
          return;
        }
        if (
          contentsEqual(
            this._sharedModel.getSource(),
            server.content,
            this._contentType
          )
        ) {
          this._stopConvergenceWatch();
          console.log(
            `Local content of '${this._path}' converged to the server ` +
              `content: rejoining on session ${newSessionId}`
          );
          const converged = this._sharedModel.getSource();
          this._rebasing = true;
          void this._adoptFollowingRolls(newSessionId, converged, server)
            .then(joined => {
              if (!joined) {
                return;
              }
              this._sharedModel.dirty = false;
              this._setPendingConflict(null);
            })
            .finally(() => {
              this._rebasing = false;
            });
        }
      }, 500);
    };
    this._sharedModel.changed.connect(onChange);
    this._stopConvergenceWatch = () => {
      this._sharedModel.changed.disconnect(onChange);
      if (debounce !== null) {
        clearTimeout(debounce);
      }
      this._stopConvergenceWatch = () => undefined;
    };
    // Check right away: the content may already be equal (e.g. the user
    // reverted before dismissing the dialog).
    onChange();
  }

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
  private _saveCounter = 0;
  private _conflictWs: WebSocket | null = null;
  private _docSessionId: string | null = null;
  private _pendingConflict: {
    localContent: JSONValue;
    newSessionId: string;
    server: IContentsModel | null;
  } | null = null;
  private _conflictStateChanged = new Signal<this, boolean>(this);
  private _rebasing = false;
  private _awaitingUserResolution = false;
  private _pendingRoll: string | null = null;
  private _rollListeners = new Set<() => void>();
  private _stopConvergenceWatch: () => void = () => undefined;
  private _onConflictSaveAs?: () => Promise<void>;
  private _onConflictRevert?: () => Promise<void>;
  private _onConflictShowDiff?: (
    localContent: JSONValue,
    actions?: WebSocketProvider.IConflictActions
  ) => Promise<void>;
}

/**
 * A namespace for WebSocketProvider statics.
 */
export namespace WebSocketProvider {
  /**
   * Actions available to conflict-resolution views.
   */
  export interface IConflictActions {
    /**
     * Discard the local content in favor of the server content, rejoining
     * the current document session when the conflict stemmed from a
     * document session change.
     */
    revert?: () => Promise<void>;
  }

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

    /**
     * Called when the user chooses "Save As" from the conflict dialog.
     */
    onConflictSaveAs?: () => Promise<void>;

    /**
     * Called when the user chooses "Revert" from the conflict dialog.
     */
    onConflictRevert?: () => Promise<void>;

    /**
     * Called when the user chooses "Show Diff" from the conflict dialog.
     * Receives the current local document content as JSON, and optionally
     * conflict-resolution actions bound to the conflict at hand (e.g. a
     * "revert" that rejoins a new document session).
     */
    onConflictShowDiff?: (
      localContent: JSONValue,
      actions?: IConflictActions
    ) => Promise<void>;
  }
}

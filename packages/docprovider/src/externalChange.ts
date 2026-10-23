/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import {
  Dialog,
  InputDialog,
  showErrorMessage,
  MainAreaWidget
} from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { Contents, ServerConnection } from '@jupyterlab/services';
import { TranslationBundle } from '@jupyterlab/translation';
import { IDisposable } from '@lumino/disposable';
import { Widget } from '@lumino/widgets';
import { ISignal } from '@lumino/signaling';

import '../style/outofband.css';

/** Server-owned status of a document whose backing file changed externally. */
export interface IExternalChangeStatus {
  originalPath: string;
  reason?: 'deleted';
}

/** Server operations needed to resolve an external change, regardless of transport. */
export interface IExternalChangeActions {
  /** Explicitly overwrite the disk version with the current snapshot. */
  overwrite?: (originalPath: string) => Promise<void>;
  /** Save the current content under a new path, preserving other clients. */
  saveAs(path: string, originalPath: string): Promise<void>;
}

/**
 * Handle external-change status and user choices independently of CRDT transport.
 *
 * Providers forward server notifications and reconnect snapshots to updateStatus,
 * call ensureCanSave before saving, and dispose the handler when leaving the
 * document. The supplied write actions must resolve after the save completes,
 * before this handler switches the local document view.
 */
export class ExternalChangeHandler implements IDisposable {
  constructor(private _options: ExternalChangeHandler.IOptions) {}

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /** Apply a status notification or reconnect snapshot from the server. */
  updateStatus(change: IExternalChangeStatus | null): void {
    if (this.isDisposed) {
      return;
    }
    if (
      change &&
      this._externalChange?.originalPath === change.originalPath &&
      this._externalChange.reason === change.reason
    ) {
      return;
    }

    const restored =
      change &&
      this._externalChange?.originalPath === change.originalPath &&
      this._externalChange.reason === 'deleted' &&
      !change.reason;
    if (!restored) {
      this._externalChangeDialog?.resolve(0);
    }
    this._externalChange = change ? { ...change } : undefined;
    this._clearNotices();
    if (!change) {
      return;
    }
    const status = this._externalChange;
    void this._options.ready
      .then(async () => {
        if (this.isDisposed || this._externalChange !== status) {
          return;
        }
        this._showNotice();
        if (!change.reason && this._options.autoReload?.()) {
          await this._run('load');
        }
      })
      .catch(console.error);
  }

  /** Prompt only when the user explicitly saves an unresolved document. */
  async ensureCanSave(): Promise<void> {
    if (!this._externalChange) {
      return;
    }
    if (!this._busy) {
      this._busy = true;
      try {
        const buttons = [Dialog.cancelButton()];
        if (this._options.actions.overwrite) {
          buttons.push(
            Dialog.warnButton({
              label: this._options.translator.__('Save to original file'),
              actions: ['overwrite']
            })
          );
        }
        buttons.push(
          Dialog.okButton({
            label: this._options.translator.__('Save As…'),
            actions: ['save-as']
          })
        );
        const dialog = new Dialog({
          title: this._options.translator.__('Save current content'),
          body: this._options.translator.__(
            'The file changed on disk. Saving to the original file will replace its disk content.'
          ),
          buttons
        });
        this._externalChangeDialog = dialog;
        const result = await dialog.launch();
        if (!this.isDisposed && this._externalChange) {
          if (result.button.actions.includes('overwrite')) {
            await this._resolve('overwrite');
          } else if (result.button.actions.includes('save-as')) {
            await this._resolve('save-as');
          }
        }
      } finally {
        this._busy = false;
        this._externalChangeDialog = undefined;
      }
    }
    const error = new Error(
      'Save cancelled while resolving an external change'
    );
    error.name = 'ModalCancelError';
    throw error;
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._externalChange = undefined;
    this._clearNotices();
    this._externalChangeDialog?.resolve(0);
  }

  private _clearNotices(): void {
    this._presentation?.dispose();
    this._presentation = undefined;
    for (const notice of this._notices) {
      notice.dispose();
    }
    this._notices.clear();
  }

  private _showNotice(): void {
    this._clearNotices();
    const change = this._externalChange!;
    const createNotice = () => this._createNotice(change);
    this._presentation =
      this._options.showNotice?.(
        createNotice(),
        () => this.ensureCanSave(),
        createNotice
      ) || undefined;
  }

  private _createNotice(change: IExternalChangeStatus): Widget {
    const notice = new Widget();
    notice.addClass('jp-CollaborationExternalChangeNotice');
    notice.node.setAttribute('role', 'status');
    const message = document.createElement('span');
    message.textContent =
      change.reason === 'deleted'
        ? this._options.translator.__(
            'The file "%1" was deleted from disk.',
            change.originalPath
          )
        : this._options.translator.__(
            'The file "%1" changed on disk.',
            change.originalPath
          );
    notice.node.appendChild(message);
    const add = (
      label: string,
      action: 'load' | 'save-as' | 'close' | 'overwrite' | 'show-diff'
    ) => {
      const button = document.createElement('button');
      button.className = 'jp-mod-styled';
      button.textContent = label;
      button.onclick = () => {
        void this._run(action);
      };
      notice.node.appendChild(button);
    };
    if (!change.reason) {
      add(this._options.translator.__('Load from disk'), 'load');
      if (this._options.onShowDiff) {
        add(this._options.translator.__('Show diff'), 'show-diff');
      }
    }
    if (this._options.actions.overwrite) {
      add(this._options.translator.__('Save to original file'), 'overwrite');
    }
    add(this._options.translator.__('Save As…'), 'save-as');
    add(this._options.translator.__('Close tab'), 'close');
    this._notices.add(notice);
    notice.disposed.connect(() => this._notices.delete(notice));
    return notice;
  }

  private async _run(
    action: 'load' | 'save-as' | 'close' | 'overwrite' | 'show-diff'
  ): Promise<void> {
    if (this._busy || this.isDisposed || !this._externalChange) {
      return;
    }
    this._busy = true;
    try {
      await this._resolve(action);
    } catch (error) {
      if (!this.isDisposed) {
        await showErrorMessage(
          this._options.translator.__('Could not resolve external change'),
          error as Error
        );
      }
    } finally {
      this._busy = false;
    }
  }

  private async _resolve(
    action: 'load' | 'save-as' | 'close' | 'overwrite' | 'show-diff'
  ): Promise<void> {
    const change = this._externalChange;
    if (!change || this.isDisposed) {
      return;
    }
    const originalPath = change.originalPath;
    if (action === 'show-diff') {
      await this._options.onShowDiff?.(originalPath);
      return;
    } else if (action === 'load') {
      await this._options.onSwitchDocument?.(originalPath);
    } else if (action === 'close') {
      this._options.onCloseDocument?.();
      // Other views can still share this unresolved document context.
      return;
    } else if (action === 'overwrite') {
      if (change.reason === 'deleted') {
        let restored = true;
        try {
          await this._options.contents.get(originalPath, { content: false });
        } catch (error) {
          if (
            !(error instanceof ServerConnection.ResponseError) ||
            error.response.status !== 404
          ) {
            throw error;
          }
          restored = false;
        }
        if (restored) {
          const dialog = new Dialog({
            title: this._options.translator.__('Replace restored file?'),
            body: this._options.translator.__(
              'The deleted file has been restored. Saving will replace its disk content.'
            ),
            buttons: [
              Dialog.cancelButton(),
              Dialog.warnButton({
                label: this._options.translator.__('Replace')
              })
            ]
          });
          this._externalChangeDialog = dialog;
          try {
            const result = await dialog.launch();
            if (!result.button.accept || this.isDisposed) {
              return;
            }
          } finally {
            this._externalChangeDialog = undefined;
          }
        }
      }
      await this._options.actions.overwrite?.(originalPath);
      await this._options.onSwitchDocument?.(originalPath);
    } else {
      const name = await InputDialog.getText({
        title: this._options.translator.__('Save shared document as'),
        label: this._options.translator.__('New path:'),
        text: await this._suggestSaveAsPath(originalPath),
        okLabel: this._options.translator.__('Save')
      });
      if (
        !name.button.accept ||
        !name.value ||
        this.isDisposed ||
        this._externalChange !== change
      ) {
        return;
      }
      await this._options.actions.saveAs(name.value, originalPath);
      await this._options.onSwitchDocument?.(name.value);
    }
    if (this._externalChange === change) {
      this.updateStatus(null);
    }
  }

  private async _suggestSaveAsPath(originalPath: string): Promise<string> {
    const directory = PathExt.dirname(originalPath);
    const filename = PathExt.basename(originalPath);
    const extension = PathExt.extname(filename);
    const stem = filename.slice(0, filename.length - extension.length);
    const base = `${stem}-Copy`;
    const listing = await this._options.contents.get(directory, {
      type: 'directory',
      content: true
    });
    const names = new Set<string>(
      listing.content.map((entry: { name: string }) => entry.name)
    );
    names.add(filename);
    let number = 1;
    while (names.has(`${base}${number}${extension}`)) {
      number++;
    }
    return PathExt.join(directory, `${base}${number}${extension}`);
  }

  private _isDisposed = false;
  private _externalChange?: IExternalChangeStatus;
  private _externalChangeDialog?: Dialog<unknown>;
  private _notices = new Set<Widget>();
  private _presentation?: IDisposable;
  private _busy = false;
}

export namespace ExternalChangeHandler {
  export interface IOptions {
    /** Wait until the document can be displayed before prompting. */
    ready: Promise<void>;
    translator: TranslationBundle;
    contents: Pick<Contents.IManager, 'get'>;
    actions: IExternalChangeActions;
    /**
     * Attach notices to document views, using createNotice for additional views.
     * Run beforeSave before the context's disk-conflict check. Return a disposable
     * to disconnect view listeners and restore normal saving when status clears.
     */
    showNotice?: (
      notice: Widget,
      beforeSave: () => Promise<void>,
      createNotice: () => Widget
    ) => IDisposable | void;
    autoReload?: () => boolean;
    /** Compare the current shared content with disk. */
    onShowDiff?: (originalPath: string) => Promise<void>;
    onSwitchDocument?: (path: string) => Promise<void>;
    onCloseDocument?: () => void;
  }
}

/** Display an external-change notice in every view sharing a document context. */
export class ExternalChangeNoticePresenter implements IDisposable {
  constructor(private _options: ExternalChangeNoticePresenter.IOptions) {
    this._initialNotice = _options.notice;
    for (const signal of _options.viewSignals) {
      signal.connect(this._onViewsChanged, this);
    }
    this._updateViews();
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  dispose(): void {
    if (this._isDisposed) {
      return;
    }
    this._isDisposed = true;
    for (const signal of this._options.viewSignals) {
      signal.disconnect(this._onViewsChanged, this);
    }
    for (const [context, guard] of this._guards) {
      if (context.save === guard.save) {
        context.save = guard.originalSave;
      }
    }
    this._guards.clear();
    for (const notice of this._notices.values()) {
      notice.dispose();
    }
    this._notices.clear();
    this._initialNotice?.dispose();
    this._initialNotice = undefined;
  }

  private _onViewsChanged(): void {
    // Let the document manager finish adopting a newly created view first.
    queueMicrotask(() => this._updateViews());
  }

  private _updateViews(): void {
    if (this.isDisposed) {
      return;
    }
    for (const view of this._options.views()) {
      this._addView(view);
    }
  }

  private _addView(view: Widget): void {
    if (
      this.isDisposed ||
      view.isDisposed ||
      !(view instanceof MainAreaWidget) ||
      this._notices.has(view)
    ) {
      return;
    }
    const context = this._options.contextForWidget(view);
    if (!context) {
      return;
    }
    if (!this._guards.has(context)) {
      const originalSave = context.save;
      const save = async () => {
        // Resolve the known external change before JupyterLab's generic
        // conflict check, which would otherwise show another set of choices.
        await this._options.beforeSave();
        await originalSave.call(context);
      };
      this._guards.set(context, { originalSave, save });
      context.save = save;
    }
    const notice = this._initialNotice ?? this._options.createNotice();
    this._initialNotice = undefined;
    this._notices.set(view, notice);
    notice.disposed.connect(() => this._notices.delete(view));
    view.contentHeader.addWidget(notice);
  }

  private _isDisposed = false;
  private _initialNotice?: Widget;
  private _notices = new Map<Widget, Widget>();
  private _guards = new Map<
    ExternalChangeNoticePresenter.ISaveContext,
    {
      originalSave: () => Promise<void>;
      save: () => Promise<void>;
    }
  >();
}

export namespace ExternalChangeNoticePresenter {
  export interface ISaveContext {
    save(): Promise<void>;
  }

  export interface IOptions {
    notice: Widget;
    beforeSave: () => Promise<void>;
    createNotice: () => Widget;
    views: () => Iterable<Widget>;
    viewSignals: ISignal<unknown, unknown>[];
    /** Return the context only for views of this provider's shared document. */
    contextForWidget: (view: Widget) => ISaveContext | undefined;
  }
}

/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { Dialog, InputDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { Contents } from '@jupyterlab/services';
import { TranslationBundle } from '@jupyterlab/translation';
import { IDisposable } from '@lumino/disposable';
import { Widget } from '@lumino/widgets';

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

    this._externalChangeDialog?.resolve(0);
    this._externalChange = change ? { ...change } : undefined;
    this._notice?.dispose();
    this._notice = undefined;
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
    this._notice?.dispose();
    this._externalChangeDialog?.resolve(0);
  }

  private _showNotice(): void {
    this._notice?.dispose();
    const change = this._externalChange!;
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
      action: 'load' | 'save-as' | 'close' | 'overwrite'
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
    }
    if (this._options.actions.overwrite) {
      add(this._options.translator.__('Save to original file'), 'overwrite');
    }
    add(this._options.translator.__('Save As…'), 'save-as');
    add(this._options.translator.__('Close tab'), 'close');
    this._notice = notice;
    this._options.showNotice?.(notice, () => this.ensureCanSave());
  }

  private async _run(
    action: 'load' | 'save-as' | 'close' | 'overwrite'
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
    action: 'load' | 'save-as' | 'close' | 'overwrite'
  ): Promise<void> {
    const change = this._externalChange;
    if (!change || this.isDisposed) {
      return;
    }
    const originalPath = change.originalPath;
    if (action === 'load') {
      await this._options.onSwitchDocument?.(originalPath);
    } else if (action === 'close') {
      this._options.onCloseDocument?.();
    } else if (action === 'overwrite') {
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
  private _notice?: Widget;
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
     * Attach the notice and run beforeSave before the context's disk-conflict
     * check. Restore the context's normal save method when the notice is disposed.
     */
    showNotice?: (notice: Widget, beforeSave: () => Promise<void>) => void;
    autoReload?: () => boolean;
    onSwitchDocument?: (path: string) => Promise<void>;
    onCloseDocument?: () => void;
  }
}

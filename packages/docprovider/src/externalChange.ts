/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { Dialog, InputDialog, showErrorMessage } from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { Contents } from '@jupyterlab/services';
import { TranslationBundle } from '@jupyterlab/translation';
import { IDisposable } from '@lumino/disposable';

import '../style/outofband.css';

/** Server-owned status of a document whose backing file changed externally. */
export interface IExternalChangeStatus {
  originalPath: string;
}

/** Server operations needed to resolve an external change, regardless of transport. */
export interface IExternalChangeActions {
  /** Release the original path so reopening it joins the disk version. */
  openOriginal(originalPath: string): Promise<void>;
  /** Save the current session under a new path, preserving other clients. */
  saveAs(path: string, originalPath: string): Promise<void>;
}

/**
 * Handle external-change status and user choices independently of CRDT transport.
 *
 * Providers forward server notifications and reconnect snapshots to updateStatus,
 * call ensureCanSave before saving, and dispose the handler when leaving the
 * document. The supplied actions must resolve after the server acknowledges the
 * operation, before this handler switches or closes the local document view.
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
    this._externalChange = change ? { ...change } : undefined;
    if (!change) {
      this._externalChangeDialog?.resolve(0);
      return;
    }
    const originalPath = change.originalPath;
    void this._options.ready
      .then(() => {
        if (
          !this.isDisposed &&
          this._externalChange?.originalPath === originalPath
        ) {
          return this._showOutOfBandDialog(originalPath);
        }
      })
      .catch(console.error);
  }

  /** Resolve a pending change before saving; cancel this save if a choice was required. */
  async ensureCanSave(): Promise<void> {
    if (this._externalChange) {
      await this._showOutOfBandDialog(this._externalChange.originalPath);
      const error = new Error(
        'Save cancelled while resolving an external change'
      );
      error.name = 'ModalCancelError';
      throw error;
    }
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this._externalChange = undefined;
    this._externalChangeDialog?.resolve(0);
  }

  private async _showOutOfBandDialog(originalPath: string): Promise<void> {
    if (this._outOfBandDialogOpen) {
      return;
    }
    this._outOfBandDialogOpen = true;
    let resolved = false;
    try {
      const buttons: Dialog.IButton[] = [];
      buttons.push(
        Dialog.warnButton({
          label: this._options.translator.__('Open original file'),
          actions: ['open-original']
        })
      );
      buttons.push(
        Dialog.okButton({
          label: this._options.translator.__('Save As…'),
          actions: ['save-as']
        })
      );
      buttons.push(
        Dialog.okButton({
          label: this._options.translator.__('Close tab'),
          actions: ['close']
        })
      );
      const dialog = new Dialog({
        title: this._options.translator.__('The file was changed externally'),
        body: this._options.translator.__(
          'The file "%1" changed on disk. ' +
            'Open the disk version in this tab, or save your current content under a new name.',
          originalPath
        ),
        buttons,
        defaultButton: 1,
        hasClose: false
      });
      dialog.addClass('jp-CollaborationExternalChangeDialog');
      this._externalChangeDialog = dialog;
      const result = await dialog.launch();
      if (this.isDisposed || !this._externalChange) {
        return;
      }
      if (result.button.actions.includes('close')) {
        // Release the original path from this session before leaving it, so a
        // later open joins the disk version even while collaborators stay here.
        await this._options.actions.openOriginal(originalPath);
        this._options.onCloseDocument?.();
        resolved = true;
      } else if (result.button.actions.includes('open-original')) {
        await this._options.actions.openOriginal(originalPath);
        await this._options.onSwitchDocument?.(originalPath);
        resolved = true;
      } else if (result.button.actions.includes('save-as')) {
        const suggestedPath = await this._suggestSaveAsPath(originalPath);
        const name = await InputDialog.getText({
          title: this._options.translator.__('Save shared document as'),
          label: this._options.translator.__('New path:'),
          text: suggestedPath,
          okLabel: this._options.translator.__('Save')
        });
        if (name.button.accept && name.value && !this.isDisposed) {
          await this._options.actions.saveAs(name.value, originalPath);
          await this._options.onSwitchDocument?.(name.value);
          resolved = true;
        }
      }
    } catch (error) {
      if (this.isDisposed) {
        return;
      }
      await showErrorMessage(
        this._options.translator.__('Could not resolve external change'),
        error as Error
      );
    } finally {
      this._outOfBandDialogOpen = false;
      this._externalChangeDialog = undefined;
    }
    if (!resolved && !this.isDisposed && this._externalChange) {
      await this._showOutOfBandDialog(originalPath);
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
  private _outOfBandDialogOpen = false;
}

export namespace ExternalChangeHandler {
  export interface IOptions {
    /** Wait until the document can be displayed before prompting. */
    ready: Promise<void>;
    translator: TranslationBundle;
    contents: Pick<Contents.IManager, 'get'>;
    actions: IExternalChangeActions;
    onSwitchDocument?: (path: string) => Promise<void>;
    onCloseDocument?: () => void;
  }
}

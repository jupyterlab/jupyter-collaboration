/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { Dialog } from '@jupyterlab/apputils';
import { TranslationBundle } from '@jupyterlab/translation';
import { IDisposable } from '@lumino/disposable';

const LOAD_TIMEOUT = 5000;

/**
 * Show shared loading choices independently of the document's transport.
 *
 * The timer starts on construction. Providers can stop it during disconnection
 * and start it for another attempt. Settling readiness or disposing the handler
 * clears the timer and closes its dialog without running a user action.
 */
export class DocumentLoadingHandler implements IDisposable {
  constructor(private _options: DocumentLoadingHandler.IOptions) {
    void _options.ready.then(
      () => this.dispose(),
      () => this.dispose()
    );
    this.start();
  }

  get isDisposed(): boolean {
    return this._isDisposed;
  }

  /** Start a new five-second wait, unless initial loading has finished. */
  start(): void {
    if (this.isDisposed) {
      return;
    }
    this.stop();
    this._timer = window.setTimeout(() => {
      this._timer = undefined;
      void this._showDialog().catch(console.error);
    }, LOAD_TIMEOUT);
  }

  /** Stop this attempt and dismiss its dialog without canceling the document. */
  stop(): void {
    clearTimeout(this._timer);
    this._timer = undefined;
    this._generation++;
    const dialog = this._dialog;
    this._dialog = undefined;
    dialog?.resolve(0);
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._isDisposed = true;
    this.stop();
  }

  private async _showDialog(): Promise<void> {
    if (this.isDisposed || this._dialog) {
      return;
    }
    const generation = this._generation;
    const trans = this._options.translator;
    const dialog = new Dialog({
      title: trans.__('Loading'),
      body: trans.__(
        'The document is taking some time to load. What would you like to do?'
      ),
      buttons: [
        Dialog.cancelButton({ label: trans.__('Cancel') }),
        Dialog.okButton({
          label: trans.__('Continue waiting'),
          actions: ['continue']
        }),
        Dialog.warnButton({ label: trans.__('Retry'), actions: ['retry'] })
      ]
    });
    this._dialog = dialog;
    let result: Dialog.IResult<unknown>;
    try {
      result = await dialog.launch();
    } finally {
      if (this._dialog === dialog) {
        this._dialog = undefined;
      }
    }
    if (this.isDisposed || generation !== this._generation) {
      return;
    }
    if (result.button.actions.includes('continue')) {
      this.start();
    } else if (result.button.actions.includes('retry')) {
      // Keep offering choices while reconnecting, without letting a late retry
      // callback reset or dismiss a newer loading dialog.
      this.start();
      await this._options.onRetry();
    } else {
      this.dispose();
      this._options.onCancel(
        trans.__('The document failed to load. Please try opening it again.')
      );
    }
  }

  private _isDisposed = false;
  private _generation = 0;
  private _timer: number | undefined;
  private _dialog: Dialog<unknown> | undefined;
}

export namespace DocumentLoadingHandler {
  export interface IOptions {
    /** Settles when initial document loading succeeds or fails. */
    ready: Promise<void>;
    translator: TranslationBundle;
    /** Reconnect or otherwise retry the document's transport. */
    onRetry: () => Promise<void>;
    /** Stop loading, reject readiness, and close the document as appropriate. */
    onCancel: (message: string) => void;
  }
}

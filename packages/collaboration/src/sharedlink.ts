// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Dialog, showDialog } from '@jupyterlab/apputils';

import { PageConfig, URLExt } from '@jupyterlab/coreutils';

import {
  ITranslator,
  TranslationBundle,
  nullTranslator
} from '@jupyterlab/translation';

import { Widget } from '@lumino/widgets';

import { Message } from '@lumino/messaging';

/**
 * Shared link dialog options
 */
export interface ISharedLinkDialogOptions {
  /**
   * Translation object.
   */
  translator?: ITranslator | null;
}

/**
 * Show the shared link dialog
 *
 * @param options Shared link dialog options
 * @returns Dialog result
 */
export async function showSharedLinkDialog({
  translator
}: ISharedLinkDialogOptions): Promise<Dialog.IResult<string>> {
  const trans = (translator ?? nullTranslator).load('collaboration');

  const token = PageConfig.getToken();
  const url = new URL(
    URLExt.normalize(
      PageConfig.getUrl({
        workspace: PageConfig.defaultWorkspace
      })
    )
  );

  return showDialog({
    title: trans.__('Share Jupyter Server Link'),
    body: new SharedLinkBody(
      url.toString(),
      token,
      PageConfig.getOption('hubUser') !== '',
      trans
    ),
    buttons: [
      Dialog.cancelButton(),
      Dialog.okButton({
        label: trans.__('Copy Link'),
        caption: trans.__('Copy the link to the Jupyter Server')
      })
    ]
  });
}

class SharedLinkBody extends Widget implements Dialog.IBodyWidget {
  private _tokenCheckbox: HTMLInputElement | null = null;
  private _warning: HTMLDivElement;

  constructor(
    private _url: string,
    private _token: string,
    private _behindHub: boolean,
    private _trans: TranslationBundle
  ) {
    super();
    this._warning = document.createElement('div');
    this.populateBody(this.node);
    this.addClass('jp-shared-link-body');
  }

  /**
   * Returns the input value.
   */
  getValue(): string {
    const withToken = this._tokenCheckbox?.checked === true;

    if (withToken) {
      const url_ = new URL(this._url);
      url_.searchParams.set('token', this._token);
      return url_.toString();
    } else {
      return this._url;
    }
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this._tokenCheckbox?.addEventListener('change', this.onTokenChange);
  }

  protected onBeforeDetach(msg: Message): void {
    this._tokenCheckbox?.removeEventListener('change', this.onTokenChange);
    super.onBeforeDetach(msg);
  }

  private updateContent(withToken: boolean): void {
    this._warning.innerHTML = '';
    const urlInput =
      this.node.querySelector<HTMLInputElement>('input[readonly]');
    if (withToken) {
      if (urlInput) {
        const url_ = new URL(this._url);
        url_.searchParams.set('token', this._token.slice(0, 5));
        urlInput.value = url_.toString() + '…';
      }
      this._warning.appendChild(document.createElement('h3')).textContent =
        this._trans.__('Security warning!');
      this._warning.insertAdjacentText(
        'beforeend',
        this._trans.__(
          'Anyone with this link has full access to your notebook server, including all your files!'
        )
      );
      this._warning.insertAdjacentHTML('beforeend', '<br>');
      this._warning.insertAdjacentText(
        'beforeend',
        this._trans.__('Please be careful who you share it with.')
      );
      this._warning.insertAdjacentHTML('beforeend', '<br>');
      if (this._behindHub) {
        this._warning.insertAdjacentText(
          'beforeend', // You can restart the server to revoke the token in a JupyterHub
          this._trans.__('They will be able to access this server AS YOU.')
        );
        this._warning.insertAdjacentHTML('beforeend', '<br>');
        this._warning.insertAdjacentText(
          'beforeend',
          this._trans.__(
            'To revoke access, go to File -> Hub Control Panel, and restart your server.'
          )
        );
      } else {
        this._warning.insertAdjacentText(
          'beforeend',
          // Elsewhere, you *must* shut down your server - no way to revoke it
          this._trans.__(
            'Currently, there is no way to revoke access other than shutting down your server.'
          )
        );
      }
    } else {
      if (urlInput) {
        urlInput.value = this._url;
      }
      if (this._behindHub) {
        this._warning.insertAdjacentText(
          'beforeend',
          this._trans.__(
            'Only users with `access:servers` permissions for this server will be able to use this link.'
          )
        );
      } else {
        this._warning.insertAdjacentText(
          'beforeend',
          this._trans.__(
            'Only authenticated users will be able to use this link.'
          )
        );
      }
    }
  }

  private onTokenChange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this.updateContent(target?.checked);
  };

  private populateBody(dialogBody: HTMLElement): void {
    dialogBody.insertAdjacentHTML(
      'afterbegin',
      `<input readonly value="${this._url}">`
    );

    if (this._token) {
      const label = dialogBody.appendChild(document.createElement('label'));
      label.insertAdjacentHTML('beforeend', '<input type="checkbox">');
      this._tokenCheckbox = label.firstChild as HTMLInputElement;
      label.insertAdjacentText(
        'beforeend',
        this._trans.__('Include token in URL')
      );
      dialogBody.insertAdjacentElement('beforeend', this._warning);
      this.updateContent(false);
    }
  }
}

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

  let canCreateShare = false;
  let canListUsers = false;
  let canListGroups = false;
  let hubApiUrl = '';

  // If hubPrefix or hubHost or hubUser is set, we are behind a JupyterHub
  if (
    PageConfig.getOption('hubPrefix') ||
    PageConfig.getOption('hubHost') ||
    PageConfig.getOption('hubUser')
  ) {
    // Prepare the Hub API URL
    const protocol = window.location.protocol;
    const hostname =
      PageConfig.getOption('hubHost') || window.location.hostname;
    const port = window.location.port;
    const prefix = PageConfig.getOption('hubPrefix');
    hubApiUrl = `${protocol}//${hostname}:${port}${prefix}api`;
    // Check Hub version for share compatibility (>= 5.0)
    const response = await fetch(hubApiUrl, {
      // A GET request on base API url returns the Hub version
      headers: {
        Authorization: `token ${token}`
      }
    });
    const data = await response.json();
    const hubVersion = data.version;
    const [major] = hubVersion.split('.').map(Number);
    if (major >= 5) {
      // The Hub version is compatible with the share feature, but we need to check if the user has rights to create a share
      const userResponse = await fetch(`${hubApiUrl}/user`, {
        headers: {
          Authorization: `token ${token}`
        }
      });
      const userData = await userResponse.json();
      // The permissions needed are "read:users:name" (to be able to get a user by his/her name) and "shares!user=self" (to be able to manage shares)
      if (
        userData.scopes.includes('read:users:name') &&
        userData.scopes.some((scope: string) => scope.startsWith('shares'))
      ) {
        // TODO: check scopes in a cleaner way?
        // If the user has the required permissions, we can create a share
        canCreateShare = true;
        // Check if the user has the correct scope to list all users (not mandatory, but makes the UI easier to use)
        if (
          userData.scopes.includes('list:users') ||
          userData.scopes.includes('read:users') ||
          userData.scopes.includes('admin:users')
        ) {
          canListUsers = true;
        }
        // Check if the user has the correct scope to list all groups (not mandatory, but makes the UI easier to use)
        if (
          userData.scopes.includes('list:groups') ||
          userData.scopes.includes('read:groups') ||
          userData.scopes.includes('admin:groups')
        ) {
          canListGroups = true;
        }
      }
    }
  }

  // If we can create a share, open the proper UI
  if (canCreateShare) {
    const serverName = PageConfig.getOption('baseUrl').split(
      PageConfig.getOption('hubUser')
    )[1].replace(/\//g, '');
    let readableServerName = serverName;
    if (readableServerName === '') {
      readableServerName = 'default';
    }
    return showDialog({
      title: trans.__('Share Jupyter Server ') + readableServerName,
      body: new ManageSharesBody(
        url.toString(),
        serverName,
        canListUsers,
        canListGroups,
        PageConfig.getOption('hubUser'),
        hubApiUrl,
        token,
        trans
      ),
      buttons: [
        Dialog.cancelButton({
          label: trans.__('Close'),
          caption: trans.__('Close the dialog')
        }),
        Dialog.okButton({
          label: trans.__('Copy Link'),
          caption: trans.__('Copy the link to the Jupyter Server')
        })
      ]
    });
    // If we can't create a real share, we show the legacy dialog that just copies the URL with the server owner's token
  } else {
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
}

class ManageSharesBody extends Widget implements Dialog.IBodyWidget {
  private _users: any[] = [];
  private _shares: any[] = [];
  private _searchInput: HTMLInputElement | null = null;
  private _searchResults: HTMLDivElement | null = null;
  private _sharesContainer: HTMLDivElement | null = null;

  constructor(
    private _url: string,
    private _serverName: string,
    private _canListUsers: boolean,
    private _canListGroups: boolean,
    private _hubUser: string,
    private _hubApiUrl: string,
    private _token: string,
    private _trans: TranslationBundle
  ) {
    super();
    this.populateBody(this.node);
    this.addClass('jp-shared-link-body');
    this.loadShares().then(() => {
      this.updateSharesList().then(() => {
        this.loadUsers();
      });
    });
  }

  /**
   * Returns the input value.
   */
  getValue(): string {
    return this._url;
  }

  protected onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
  }

  protected onBeforeDetach(msg: Message): void {
    super.onBeforeDetach(msg);
  }

  private async loadUsers(): Promise<void> {
    // If possible, download the users list for the UI
    if (this._canListUsers) {
      const usersResponse = await fetch(`${this._hubApiUrl}/users`, {
        headers: {
          Authorization: `token ${this._token}`
        }
      });
      const usersData = await usersResponse.json();
      const sharedUserNames = new Set(
        this._shares
          .filter(share => share.type === 'user')
          .map(share => share.name)
      );
      // We remove from the list the current user and the users that already have a share
      this._users = usersData
        .filter(
          (user: any) =>
            user.name !== this._hubUser && !sharedUserNames.has(user.name)
        )
        .map((user: any) => ({ ...user, type: 'user' }));
    }
    // If possible, download the groups list for the UI and add them to the users list
    if (this._canListGroups) {
      const groupsResponse = await fetch(`${this._hubApiUrl}/groups`, {
        headers: {
          Authorization: `token ${this._token}`
        }
      });
      const groupsData = await groupsResponse.json();
      const sharedGroupNames = new Set(
        this._shares
          .filter(share => share.type === 'group')
          .map(share => share.name)
      );
      this._users = this._users.concat(
        groupsData
          .filter((group: any) => !sharedGroupNames.has(group.name))
          .map((group: any) => ({ name: group.name, type: 'group' }))
      );
    }

    // Sort users and groups by name in alphabetical order
    this._users.sort((a, b) => a.name.localeCompare(b.name));

    this.updateSearchResults();
  }

  private async loadShares(): Promise<void> {
    const sharesResponse = await fetch(
      `${this._hubApiUrl}/shares/${this._hubUser}/${this._serverName}`,
      {
        headers: {
          Authorization: `token ${this._token}`
        }
      }
    );
    const sharesData = await sharesResponse.json();
    this._shares = sharesData.items.map((item: any) => ({
      name: item.user?.name || item.group?.name,
      createdAt: item.created_at,
      type: item.user ? 'user' : 'group'
    }));
  }

  private async createShare(sharewith: any, type: any): Promise<void> {
    await fetch(
      `${this._hubApiUrl}/shares/${this._hubUser}/${this._serverName}`,
      {
        method: 'POST',
        headers: {
          Authorization: `token ${this._token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          [type]: sharewith.name
        })
      }
    );
  }

  private async deleteShare(sharewith: any, type: any): Promise<void> {
    await fetch(
      `${this._hubApiUrl}/shares/${this._hubUser}/${this._serverName}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `token ${this._token}`
        },
        body: JSON.stringify({
          [type]: sharewith.name
        })
      }
    );
  }

  private populateBody(dialogBody: HTMLElement): void {
    // Add search input
    const searchContainer = document.createElement('div');
    searchContainer.classList.add('search-container');
    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.classList.add('search-input');
    this._searchInput.placeholder = this._trans.__(
      'Type to search for a user or a group to share your server with...'
    );
    this._searchInput.addEventListener('input', () => {
      this.updateSearchResults();
    });
    searchContainer.appendChild(this._searchInput);
    dialogBody.appendChild(searchContainer);

    // Add search results container
    this._searchResults = document.createElement('div');
    this._searchResults.classList.add('search-results');
    dialogBody.appendChild(this._searchResults);

    // Add selected users container
    this._sharesContainer = document.createElement('div');
    this._sharesContainer.classList.add('selected-users');
    dialogBody.appendChild(this._sharesContainer);

    dialogBody.insertAdjacentHTML(
      'beforeend',
      `<input readonly value="${this._url}" class="url-input">`
    );
    dialogBody.insertAdjacentHTML('beforeend', '<br>');
    dialogBody.insertAdjacentText(
      'beforeend',
      this._trans.__(
        'Warning: Anyone you share this server with will have access to all your files, not just the currently open file.'
      )
    );
    dialogBody.insertAdjacentHTML('beforeend', '<br>');
    dialogBody.insertAdjacentText(
      'beforeend',
      this._trans.__(
        'If your Hub administrator allows it, you can create another server dedicated to sharing a specific project.'
      )
    );
  }

  private updateSearchResults(): void {
    if (!this._searchResults) {
      return;
    }
    this._searchResults.innerHTML = '';
    const query = this._searchInput?.value || '';

    const filteredUsers = this._users.filter(
      user =>
        user.name.toLowerCase().includes(query.toLowerCase()) || query === ''
    );

    filteredUsers.forEach(user => {
      const userElement = document.createElement('div');
      userElement.classList.add('user-item');
      userElement.textContent = user.name;
      userElement.addEventListener('click', async () => {
        await this.createShare(user, user.type);
        await this.loadShares();
        await this.updateSharesList();
        // Removing the new user from the search results
        const sharedUserNames = new Set(this._shares.map(share => share.name));
        this._users = this._users.filter(
          (user: any) =>
            user.name !== this._hubUser && !sharedUserNames.has(user.name)
        );
        this.updateSearchResults();
      });
      this._searchResults?.appendChild(userElement);
    });
  }

  private async updateSharesList(): Promise<void> {
    if (!this._sharesContainer) {
      return;
    }
    this._sharesContainer.innerHTML = '';

    const table = document.createElement('table');
    table.classList.add('shares-table');

    const headerRow = document.createElement('tr');
    headerRow.innerHTML = `
      <th>${this._trans.__('Shared with')}</th>
      <th>${this._trans.__('Shared since')}</th>
      <th>${this._trans.__('Actions')}</th>
    `;
    table.appendChild(headerRow);

    if (this._shares.length === 0) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.textContent = this._trans.__(
        'Your server is not shared to anybody yet. You can search for users and groups above.'
      );
      row.appendChild(cell);
      table.appendChild(row);
    } else {
      this._shares.forEach(share => {
        const row = document.createElement('tr');
        const formattedDate = new Date(share.createdAt).toLocaleString([], {
          hour: '2-digit',
          minute: '2-digit',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });

        row.innerHTML = `
        <td>${
          share.type === 'group'
            ? this._trans.__('Group ') + share.name
            : share.name
        }</td>
        <td>${formattedDate}</td>
        <td></td>
      `;

        const revokeButton = document.createElement('button');
        revokeButton.textContent = this._trans.__('Revoke');
        revokeButton.classList.add('jp-mod-styled');
        revokeButton.addEventListener('click', async () => {
          await this.deleteShare(share, share.type);
          await this.loadShares();
          await this.updateSharesList();
          await this.loadUsers();
          // Removing the new user from the search results
          const sharedUserNames = new Set(
            this._shares.map(share => share.name)
          );
          this._users = this._users.filter(
            (user: any) =>
              user.name !== this._hubUser && !sharedUserNames.has(user.name)
          );
          await this.updateSearchResults();
        });

        row.querySelector('td:last-child')?.appendChild(revokeButton);
        table.appendChild(row);
      });
    }

    this._sharesContainer.appendChild(table);
  }
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

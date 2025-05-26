// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Dialog, ReactWidget, showDialog } from '@jupyterlab/apputils';

import { ServerConnection, User } from '@jupyterlab/services';

import { URLExt } from '@jupyterlab/coreutils';

import { IRenderMime } from '@jupyterlab/rendermime-interfaces';

import { Panel } from '@lumino/widgets';

import * as React from 'react';

import { UserDetailsBody, UserIconComponent } from './components';

/**
 * The properties for the UserInfoBody.
 */
type UserInfoProps = {
  userManager: User.IManager;
  trans: IRenderMime.TranslationBundle;
};

export class UserInfoPanel extends Panel {
  private _profile: User.IManager;
  private _body: UserInfoBody | null;

  constructor(options: UserInfoProps) {
    super({});
    this.addClass('jp-UserInfoPanel');
    this._profile = options.userManager;
    this._body = null;

    if (this._profile.isReady) {
      this._body = new UserInfoBody({
        userManager: this._profile,
        trans: options.trans
      });
      this.addWidget(this._body);
      this.update();
    } else {
      this._profile.ready
        .then(() => {
          this._body = new UserInfoBody({
            userManager: this._profile,
            trans: options.trans
          });
          this.addWidget(this._body);
          this.update();
        })
        .catch(e => console.error(e));
    }
  }
}

/**
 * A SettingsWidget for the user.
 */
export class UserInfoBody
  extends ReactWidget
  implements Dialog.IBodyWidget<User.IManager>
{
  private _userManager: User.IManager;
  private _trans: IRenderMime.TranslationBundle;
  /**
   * Constructs a new settings widget.
   */
  constructor(props: UserInfoProps) {
    super();
    this._userManager = props.userManager;
    this._trans = props.trans;
  }

  get user(): User.IManager {
    return this._userManager;
  }

  set user(user: User.IManager) {
    this._userManager = user;
    this.update();
  }

  private onClick = () => {
    if (!this._userManager.identity) {
      return;
    }
    showDialog({
      body: new UserDetailsBody({
        userManager: this._userManager
      }),
      title: this._trans.__('User Details')
    }).then(async result => {
      if (result.button.accept) {
        // Call the Jupyter Server API to update the user field
        try {
          const settings = ServerConnection.makeSettings();
          const url = URLExt.join(settings.baseUrl, '/api/me');
          const body = {
            method: 'PATCH',
            body: JSON.stringify(result.value)
          };

          let response: Response;
          try {
            response = await ServerConnection.makeRequest(url, body, settings);
          } catch (error) {
            throw new ServerConnection.NetworkError(error as Error);
          }

          if (!response.ok) {
            const errorMsg = this._trans.__('Failed to update user data');
            throw new Error(errorMsg);
          }

          // Refresh user information
          this._userManager.refreshUser();
        } catch (error) {
          console.error(error);
        }
      }
    });
  };

  render(): JSX.Element {
    return (
      <div className="jp-UserInfo-Container">
        <UserIconComponent
          userManager={this._userManager}
          onClick={this.onClick}
        />
      </div>
    );
  }
}

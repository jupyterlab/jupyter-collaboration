import React from 'react';

import { ReactWidget } from '@jupyterlab/apputils';
/*
import { LabIcon } from '@jupyterlab/ui-components';
import onlineSvg from './../../style/icons/connect_without_contact-black-24dp.svg';
export const onlineIcon = new LabIcon({
  name: 'rtc:online',
  svgstr: onlineSvg
});
*/
/**
 * React Users Component.
 *
 * @returns The React component
 */
const UsersComponent = (data: any) => {
  const users = data.users.users
  return (
    <div>
      {
        users.map((user: any) => 
          <div key={user.login}>
            <a href={`https://github.com/${user.login}`} target="_blank">
              <img src={user.avatar_url} style={{width: '100px'}}/>
              <div>{user.name}</div>
              <div className='jp-Users-username'>@{user.login}</div>
              {user.bio && <div className='jp-Users-bio'>Bio: {user.bio}</div>}
            </a>
{/*
            <onlineIcon.react tag="span" right="7px" top="5px" />
*/}
            <hr/>
          </div> 
        )
      }
    </div>
  );
}

/**
 * A Users Lumino Widget that wraps a UsersComponent.
 */
class UsersWidget extends ReactWidget {

  private users: [] = [];

  /**
   * Constructs a new CounterWidget.
   */
  public constructor() {
    super();
    this.addClass('jp-Auth-Widget');
  }

  public render(): JSX.Element {
    return <UsersComponent users={this.users}/>;
  }

  public setUsers(users: []) {
    this.users = users;
    this.update();
  }

  public setUserStatus(status: any) {
    this.users.map(u => console.log(u));
    this.update();
  }

}

export default UsersWidget;

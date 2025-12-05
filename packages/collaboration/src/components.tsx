// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { User } from '@jupyterlab/services';
import { ReactWidget } from '@jupyterlab/ui-components';

import React, { useEffect, useState } from 'react';

type UserIconProps = {
  /**
   * The user manager instance.
   */
  userManager: User.IManager;
  /**
   * An optional onclick handler for the icon.
   *
   */
  onClick?: () => void;
};

/**
 * React component for the user icon.
 *
 * @returns The React component
 */
export function UserIconComponent(props: UserIconProps): JSX.Element {
  const { userManager, onClick } = props;
  const [user, setUser] = useState(userManager.identity!);

  useEffect(() => {
    const updateUser = () => {
      setUser(userManager.identity!);
    };

    userManager.userChanged.connect(updateUser);

    return () => {
      userManager.userChanged.disconnect(updateUser);
    };
  }, [userManager]);

  return (
    <div
      title={user.display_name}
      className="jp-UserInfo-Icon"
      style={{ backgroundColor: user.color }}
      onClick={onClick}
    >
      <span>{user.initials}</span>
    </div>
  );
}

type UserDetailsBodyProps = {
  /**
   * The user manager instance.
   **/
  userManager: User.IManager;
};

/**
 * React widget for the user details.
 **/
export class UserDetailsBody extends ReactWidget {
  /**
   * Constructs a new user details widget.
   */
  constructor(props: UserDetailsBodyProps) {
    super();
    this._userManager = props.userManager;
  }

  /**
   * Get the user modified fields.
   */
  getValue(): UserUpdate {
    return this._userUpdate;
  }

  /**
   * Handle change on a field, by updating the user object.
   */
  private _onChange = (
    event: React.ChangeEvent<HTMLInputElement>,
    field: string
  ) => {
    const updatableFields = (this._userManager.permissions?.[
      'updatable_fields'
    ] || []) as string[];
    if (!updatableFields?.includes(field)) {
      return;
    }

    this._userUpdate[field as keyof Omit<User.IIdentity, 'username'>] =
      event.target.value;
  };

  render() {
    const identity = this._userManager.identity;
    if (!identity) {
      return <div className="jp-UserInfo-Details">Error loading user info</div>;
    }
    const updatableFields = (this._userManager.permissions?.[
      'updatable_fields'
    ] || []) as string[];

    return (
      <div className="jp-UserInfo-Details">
        {Object.keys(identity).map((field: string) => {
          const id = `jp-UserInfo-Value-${field}`;
          return (
            <div key={field} className="jp-UserInfo-Field">
              <label htmlFor={id}>{field}</label>
              <input
                type={'text'}
                name={field}
                id={id}
                onInput={(event: React.ChangeEvent<HTMLInputElement>) =>
                  this._onChange(event, field)
                }
                defaultValue={identity[field] as string}
                disabled={!updatableFields?.includes(field)}
              />
            </div>
          );
        })}
      </div>
    );
  }

  private _userManager: User.IManager;
  private _userUpdate: UserUpdate = {};
}

/**
 * Type for the user update object.
 */
export type UserUpdate = {
  [field in keyof Omit<User.IIdentity, 'username'>]: string;
};

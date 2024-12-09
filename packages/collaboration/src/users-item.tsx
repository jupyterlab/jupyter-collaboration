/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { DocumentRegistry } from '@jupyterlab/docregistry';
import { User } from '@jupyterlab/services';
import { classes, ReactWidget } from '@jupyterlab/ui-components';
import * as React from 'react';

const USERS_ITEM_CLASS = 'jp-toolbar-users-item';

/**
 * The namespace for the UsersItem component.
 */
export namespace UsersItem {
  /**
   * Properties of the component.
   */
  export interface IProps {
    /**
     * The model of the document.
     */
    model: DocumentRegistry.IModel | null;

    /**
     * A function to display the user icons, optional.
     * This function will overwrite the default one, and can be used to handle event on
     * icons.
     */
    iconRenderer?: (props: UsersItem.IIconRendererProps) => JSX.Element;
  }

  /**
   * The state of the component.
   */
  export interface IState {
    /**
     * The user list.
     */
    usersList: IUserData[];
  }

  /**
   * Properties send to the iconRenderer function.
   */
  export interface IIconRendererProps
    extends React.HTMLAttributes<HTMLElement> {
    /**
     * The user.
     */
    user: IUserData;

    /**
     * The document's model.
     */
    model?: DocumentRegistry.IModel;
  }

  /**
   * The user data type.
   */
  export type IUserData = {
    /**
     * User id (the client id of the awareness).
     */
    userId: number;
    /**
     * User data.
     */
    userData: User.IIdentity;
  };
}

/**
 * A component displaying the collaborative users of a document.
 */
export class UsersItem extends React.Component<
  UsersItem.IProps,
  UsersItem.IState
> {
  constructor(props: UsersItem.IProps) {
    super(props);
    this._model = props.model;
    this._iconRenderer = props.iconRenderer ?? null;
    this.state = { usersList: [] };
  }

  /**
   * Static method to create a widget.
   */
  static createWidget(options: UsersItem.IProps): ReactWidget {
    return ReactWidget.create(<UsersItem {...options} />);
  }

  componentDidMount(): void {
    this._model?.sharedModel.awareness.on('change', this._awarenessChange);
    this._awarenessChange();
  }

  /**
   * Filter out the duplicated users, which can happen temporary on reload.
   */
  private filterDuplicated(
    usersList: UsersItem.IUserData[]
  ): UsersItem.IUserData[] {
    const newList: UsersItem.IUserData[] = [];
    const selected = new Set<string>();
    for (const element of usersList) {
      if (
        element?.userData?.username &&
        !selected.has(element.userData.username)
      ) {
        selected.add(element.userData.username);
        newList.push(element);
      }
    }
    return newList;
  }

  render(): React.ReactNode {
    const IconRenderer = this._iconRenderer ?? DefaultIconRenderer;
    return (
      <div className={USERS_ITEM_CLASS}>
        {this.filterDuplicated(this.state.usersList).map(user => {
          if (
            this._model &&
            user.userId !== this._model.sharedModel.awareness.clientID
          ) {
            return IconRenderer({ user, model: this._model });
          }
        })}
      </div>
    );
  }

  /**
   * Triggered when a change occurs in the document awareness, to build again the users list.
   */
  private _awarenessChange = () => {
    const clients = this._model?.sharedModel.awareness.getStates() as Map<
      number,
      User.IIdentity
    >;

    const users: UsersItem.IUserData[] = [];
    if (clients) {
      clients.forEach((val, key) => {
        if (val.user) {
          users.push({ userId: key, userData: val.user as User.IIdentity });
        }
      });
    }
    this.setState(old => ({ ...old, usersList: users }));
  };

  private _model: DocumentRegistry.IModel | null;
  private _iconRenderer:
    | ((props: UsersItem.IIconRendererProps) => JSX.Element)
    | null;
}

/**
 * Default renderer for the user icon.
 */
export function DefaultIconRenderer(
  props: UsersItem.IIconRendererProps
): JSX.Element {
  let el: JSX.Element;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { user, model, ...htmlProps } = props;

  const iconClasses = classes('lm-MenuBar-itemIcon', props.className || '');
  if (user.userData.avatar_url) {
    el = (
      <div
        {...htmlProps}
        key={user.userId}
        title={user.userData.display_name}
        className={classes(iconClasses, 'jp-MenuBar-imageIcon')}
      >
        <img src={user.userData.avatar_url} alt="" />
      </div>
    );
  } else {
    el = (
      <div
        {...htmlProps}
        key={user.userId}
        title={user.userData.display_name}
        className={classes(iconClasses, 'jp-MenuBar-anonymousIcon')}
        style={{ backgroundColor: user.userData.color }}
      >
        <span>{user.userData.initials}</span>
      </div>
    );
  }

  return el;
}

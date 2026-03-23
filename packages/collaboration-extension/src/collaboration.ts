// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IToolbarWidgetRegistry } from '@jupyterlab/apputils';
import {
  EditorExtensionRegistry,
  IEditorExtensionRegistry
} from '@jupyterlab/codemirror';
import { IGlobalAwareness } from '@jupyter/collaborative-drive';
import { WebSocketAwarenessProvider } from '@jupyter/docprovider';
import { SidePanel, usersIcon } from '@jupyterlab/ui-components';
import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';
import { IStateDB, StateDB } from '@jupyterlab/statedb';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { Menu, MenuBar, Widget } from '@lumino/widgets';

import { IAwareness } from '@jupyter/ydoc';

import {
  CollaboratorsPanel,
  IUserMenu,
  remoteUserCursors,
  RendererUserMenu,
  UserInfoPanel,
  UserMenu
} from '@jupyter/collaboration';

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

/**
 * Jupyter plugin providing the IUserMenu.
 */
export const userMenuPlugin: JupyterFrontEndPlugin<IUserMenu> = {
  id: '@jupyter/collaboration-extension:userMenu',
  description: 'Provide connected user menu.',
  requires: [],
  provides: IUserMenu,
  activate: (app: JupyterFrontEnd): IUserMenu => {
    const { commands } = app;
    const { user } = app.serviceManager;
    return new UserMenu({ commands, user });
  }
};

/**
 * Jupyter plugin adding the IUserMenu to the menu bar if collaborative flag enabled.
 */
export const menuBarPlugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:user-menu-bar',
  description: 'Add user menu to the interface.',
  autoStart: true,
  requires: [IUserMenu, IToolbarWidgetRegistry],
  activate: async (
    app: JupyterFrontEnd,
    menu: IUserMenu,
    toolbarRegistry: IToolbarWidgetRegistry
  ): Promise<void> => {
    const { user } = app.serviceManager;

    const menuBar = new MenuBar({
      forceItemsPosition: {
        forceX: false,
        forceY: false
      },
      renderer: new RendererUserMenu(user)
    });
    menuBar.id = 'jp-UserMenu';
    user.userChanged.connect(() => menuBar.update());
    menuBar.addMenu(menu as Menu);

    toolbarRegistry.addFactory('TopBar', 'user-menu', () => menuBar);
  }
};

/**
 * Jupyter plugin creating a global awareness for RTC.
 */
export const rtcGlobalAwarenessPlugin: JupyterFrontEndPlugin<IAwareness> = {
  id: '@jupyter/collaboration-extension:rtcGlobalAwareness',
  description: 'Add global awareness to share working document of users.',
  requires: [IStateDB],
  provides: IGlobalAwareness,
  activate: (app: JupyterFrontEnd, state: StateDB): IAwareness => {
    const { user } = app.serviceManager;

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);

    const server =
      app.serviceManager.serverSettings ?? ServerConnection.makeSettings();
    const url = URLExt.join(server.wsUrl, 'api/collaboration/room');

    new WebSocketAwarenessProvider({
      url: url,
      roomID: 'JupyterLab:globalAwareness',
      awareness: awareness,
      user: user
    });

    state.changed.connect(async () => {
      const data: any = await state.toJSON();
      const current: string = data['layout-restorer:data']?.main?.current || '';

      // For example matches `notebook:Untitled.ipynb` or `editor:untitled.txt`,
      // but not when in launcher or terminal.
      if (current.match(/^\w+:.+/)) {
        awareness.setLocalStateField('current', current);
      } else {
        awareness.setLocalStateField('current', null);
      }
    });

    return awareness;
  }
};

/**
 * Jupyter plugin adding the RTC information to the application left panel if collaborative flag enabled.
 */
export const rtcPanelPlugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:rtcPanel',
  description: 'Add side panel to display all currently connected users.',
  autoStart: true,
  requires: [IGlobalAwareness],
  optional: [ITranslator],
  activate: (
    app: JupyterFrontEnd,
    awareness: Awareness,
    translator: ITranslator | null
  ): void => {
    const { user } = app.serviceManager;

    const trans = (translator ?? nullTranslator).load('jupyter_collaboration');

    const userPanel = new SidePanel({
      alignment: 'justify'
    });
    userPanel.id = 'jp-collaboration-panel';
    userPanel.title.icon = usersIcon;
    userPanel.title.caption = trans.__('Collaboration');
    userPanel.addClass('jp-RTCPanel');
    app.shell.add(userPanel, 'left', { rank: 300 });

    const currentUserPanel = new UserInfoPanel({
      userManager: user,
      serverSettings: app.serviceManager.serverSettings,
      trans
    });
    currentUserPanel.title.label = trans.__('User info');
    currentUserPanel.title.caption = trans.__('User information');
    userPanel.addWidget(currentUserPanel);

    const fileopener = (path: string) => {
      void app.commands.execute('docmanager:open', { path });
    };

    const collaboratorsPanel = new CollaboratorsPanel(
      user,
      awareness,
      fileopener,
      app.docRegistry
    );
    collaboratorsPanel.title.label = trans.__('Online Collaborators');
    userPanel.addWidget(collaboratorsPanel);
  }
};

export const userEditorCursors: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:userEditorCursors',
  description:
    'Add CodeMirror extension to display remote user cursors and selections.',
  autoStart: true,
  requires: [IEditorExtensionRegistry],
  activate: (
    app: JupyterFrontEnd,
    extensions: IEditorExtensionRegistry
  ): void => {
    extensions.addExtension({
      name: 'remote-user-cursors',
      factory(options) {
        const { awareness, ysource: ytext } = options.model.sharedModel as any;
        return EditorExtensionRegistry.createImmutableExtension(
          remoteUserCursors({ awareness, ytext })
        );
      }
    });
  }
};

/**
 * PoC plugin to override RTC displayed name from URL query param.
 */
export const rtcIdentityFromUrlPlugin: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:rtcIdentityFromUrl',
  description:
    'Read username from URL and apply it to RTC awareness user state.',
  autoStart: true,
  requires: [IGlobalAwareness],
  activate: (app: JupyterFrontEnd, globalAwareness: Awareness): void => {
    const username = getUsernameFromUrl();
    if (!username) {
      return;
    }

    const applyIdentity = (awareness: Awareness | null): void => {
      if (!awareness) {
        return;
      }
      const localState = awareness.getLocalState() as
        | { user?: Record<string, unknown> }
        | null;
      const userState = localState?.user ?? {};
      awareness.setLocalStateField('user', {
        ...userState,
        name: username,
        color:
          typeof userState.color === 'string'
            ? userState.color
            : colorFromUsername(username)
      });
    };

    const applyForCurrentWidget = (): void => {
      applyIdentity(getWidgetAwareness(app.shell.currentWidget));
    };

    applyIdentity(globalAwareness);
    applyForCurrentWidget();

    app.shell.currentChanged?.connect(() => {
      applyForCurrentWidget();
    });

    // Providers set awareness on user changes, so apply the URL override again.
    app.serviceManager.user.userChanged.connect(() => {
      applyIdentity(globalAwareness);
      applyForCurrentWidget();
    });
  }
};

function getUsernameFromUrl(): string | null {
  const username = new URLSearchParams(window.location.search).get('username');
  if (!username) {
    return null;
  }
  const trimmed = username.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getWidgetAwareness(widget: Widget | null): Awareness | null {
  if (!widget) {
    return null;
  }

  const contextAwareWidget = widget as unknown as {
    context?: {
      model?: {
        sharedModel?: {
          awareness?: unknown;
        };
      };
    };
  };
  const awareness = contextAwareWidget.context?.model?.sharedModel?.awareness;
  return isAwareness(awareness) ? awareness : null;
}

function isAwareness(value: unknown): value is Awareness {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.getLocalState === 'function' &&
    typeof candidate.setLocalStateField === 'function'
  );
}

function colorFromUsername(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash << 5) - hash + username.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

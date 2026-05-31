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
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { IGlobalAwareness } from '@jupyter/collaborative-drive';
import { IAwarenessProviderFactory } from '@jupyter/docprovider';
import { INotebookTracker } from '@jupyterlab/notebook';
import { SidePanel, usersIcon } from '@jupyterlab/ui-components';
import { IStateDB, StateDB } from '@jupyterlab/statedb';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { Menu, MenuBar } from '@lumino/widgets';

import { IAwareness, IYText } from '@jupyter/ydoc';

import {
  CollaboratorsPanel,
  ICollaboratorCursorQuery,
  ICollaboratorAwareness,
  getCollaboratorCursorRange,
  IUserMenu,
  remoteUserCursors,
  RendererUserMenu,
  UserInfoPanel,
  UserMenu
} from '@jupyter/collaboration';

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';

/**
 * The command IDs used by the plugin.
 */
namespace CommandIDs {
  export const scrollToCursor = 'collaboration:scroll-to-cursor';
}

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
  requires: [IStateDB, IAwarenessProviderFactory],
  provides: IGlobalAwareness,
  activate: (
    app: JupyterFrontEnd,
    state: StateDB,
    factory: IAwarenessProviderFactory
  ): IAwareness => {
    const { user } = app.serviceManager;

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);

    const awarenessOptions = {
      roomID: 'JupyterLab:globalAwareness',
      awareness: awareness,
      user: user,
      serverSettings: app.serviceManager.serverSettings
    };

    factory.create(awarenessOptions);

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
  optional: [ITranslator, IEditorTracker, INotebookTracker],
  activate: (
    app: JupyterFrontEnd,
    awareness: Awareness,
    translator: ITranslator | null,
    editorTracker: IEditorTracker | null,
    notebookTracker: INotebookTracker | null
  ): void => {
    const { user } = app.serviceManager;
    const { commands } = app;

    const trans = (translator ?? nullTranslator).load('jupyter_collaboration');

    const getPathFromCurrent = (
      current: string | null | undefined
    ): string | null => {
      if (!current) {
        return null;
      }
      const separator = current.indexOf(':');
      if (separator === -1 || separator === current.length - 1) {
        return null;
      }
      return current.slice(separator + 1);
    };

    const revealInEditor = (
      sharedModel: IYText,
      query: ICollaboratorCursorQuery,
      editor: {
        getPositionAt: (offset: number) => any;
        revealSelection: (selection: any) => void;
        focus: () => void;
      }
    ): boolean => {
      if (!sharedModel.awareness) {
        return false;
      }
      const cursor = getCollaboratorCursorRange(
        sharedModel.awareness,
        sharedModel.ysource,
        query
      );
      if (!cursor) {
        return false;
      }

      const start = editor.getPositionAt(cursor.start);
      const end = editor.getPositionAt(cursor.end);
      if (!start || !end) {
        return false;
      }

      editor.revealSelection({ start, end });
      editor.focus();
      return true;
    };

    commands.addCommand(CommandIDs.scrollToCursor, {
      label: trans.__('Scroll to Collaborator Cursor'),
      execute: async args => {
        const username =
          typeof args['username'] === 'string' ? args['username'] : null;
        const rawClientId = args['clientId'];
        const clientId =
          typeof rawClientId === 'number' && Number.isInteger(rawClientId)
            ? rawClientId
            : typeof rawClientId === 'string' &&
              rawClientId.length > 0 &&
              Number.isInteger(Number(rawClientId))
            ? Number(rawClientId)
            : null;
        let path = typeof args['path'] === 'string' ? args['path'] : null;

        if (!username && clientId === null) {
          return false;
        }

        const collaboratorQuery: ICollaboratorCursorQuery = {};
        if (username) {
          collaboratorQuery.username = username;
        }
        if (clientId !== null) {
          collaboratorQuery.clientId = clientId;
        }

        if (!path) {
          for (const [remoteClientId, state] of awareness.getStates()) {
            if (
              collaboratorQuery.clientId !== undefined &&
              remoteClientId !== collaboratorQuery.clientId
            ) {
              continue;
            }
            if (
              collaboratorQuery.username &&
              state.user?.username !== collaboratorQuery.username
            ) {
              continue;
            }
            path = getPathFromCurrent(state.current as string | null);
            if (path) {
              break;
            }
          }
        }

        if (!path) {
          return false;
        }

        const openedWidget = (await commands.execute('docmanager:open', {
          path
        })) as
          | {
              context?: { ready?: Promise<void> };
              revealed?: Promise<void>;
            }
          | undefined;
        await openedWidget?.context?.ready;
        await openedWidget?.revealed;

        let editorWidget = editorTracker?.find(
          widget => widget.context.path === path
        );
        if (!editorWidget && editorTracker) {
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise<void>(resolve => setTimeout(resolve, 20));
            editorWidget = editorTracker.find(
              widget => widget.context.path === path
            );
            if (editorWidget) {
              break;
            }
          }
        }
        if (editorWidget) {
          const sharedModel = editorWidget.content.model.sharedModel as IYText;
          if (
            revealInEditor(
              sharedModel,
              collaboratorQuery,
              editorWidget.content.editor
            )
          ) {
            return true;
          }
        }

        let notebookWidget = notebookTracker?.find(
          widget => widget.context.path === path
        );
        if (!notebookWidget && notebookTracker) {
          for (let attempt = 0; attempt < 5; attempt++) {
            await new Promise<void>(resolve => setTimeout(resolve, 20));
            notebookWidget = notebookTracker.find(
              widget => widget.context.path === path
            );
            if (notebookWidget) {
              break;
            }
          }
        }
        if (!notebookWidget?.content.model) {
          return false;
        }

        let cursorCell: { index: number; start: number; end: number } | null =
          null;
        for (let i = 0; i < notebookWidget.content.widgets.length; i++) {
          const sharedModel = notebookWidget.content.widgets[i].model
            .sharedModel as unknown as IYText;
          if (!sharedModel.ysource || !sharedModel.awareness) {
            continue;
          }
          const cursor = getCollaboratorCursorRange(
            sharedModel.awareness,
            sharedModel.ysource,
            collaboratorQuery
          );
          if (!cursor) {
            continue;
          }
          cursorCell = {
            index: i,
            start: cursor.start,
            end: cursor.end
          };
          break;
        }

        if (!cursorCell) {
          return false;
        }

        notebookWidget.content.activeCellIndex = cursorCell.index;
        await notebookWidget.content.scrollToItem(cursorCell.index, 'smart');

        const cell = notebookWidget.content.widgets[cursorCell.index];
        await cell.ready;
        const cellEditor = cell.editor;
        if (!cellEditor) {
          return false;
        }

        const start = cellEditor.getPositionAt(cursorCell.start);
        const end = cellEditor.getPositionAt(cursorCell.end);
        if (!start || !end) {
          return false;
        }

        cellEditor.revealSelection({ start, end });
        cellEditor.focus();
        return true;
      }
    });

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

    const followCursor = (collaborator: ICollaboratorAwareness) => {
      const path = getPathFromCurrent(collaborator.current);
      if (!path) {
        return;
      }
      void commands.execute(CommandIDs.scrollToCursor, {
        username: collaborator.user.username,
        clientId: collaborator.clientId,
        path
      });
    };

    const collaboratorsPanel = new CollaboratorsPanel(
      user,
      awareness,
      fileopener,
      app.docRegistry,
      followCursor,
      trans.__('Scroll to cursor')
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

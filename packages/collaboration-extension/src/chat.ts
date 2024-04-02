// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import { chatIcon } from 'chat-jupyter';
import {
  IChatFileType,
  IChatPanel,
  IGlobalAwareness
} from '@jupyter/collaboration';
import {
  ChatPanel,
  ChatWidgetFactory,
  CollaborativeChatModelFactory,
  CollaborativeChatModel,
  CollaborativeChatWidget,
  ICollaborativeDrive,
  YChat
} from '@jupyter/docprovider';
import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  IThemeManager,
  InputDialog,
  WidgetTracker
} from '@jupyterlab/apputils';
import { PathExt } from '@jupyterlab/coreutils';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { addIcon } from '@jupyterlab/ui-components';
import { Awareness } from 'y-protocols/awareness';

const pluginIds = {
  chatDocument: '@jupyter/collaboration-extension:chat-document',
  chat: '@jupyter/collaboration-extension:chat'
};

/**
 * Extension registering the chat file type.
 */
export const chatDocument: JupyterFrontEndPlugin<IChatFileType> = {
  id: pluginIds.chatDocument,
  description: 'A document registration for collaborative chat',
  autoStart: true,
  requires: [IGlobalAwareness, IRenderMimeRegistry],
  optional: [ICollaborativeDrive, IThemeManager],
  provides: IChatFileType,
  activate: (
    app: JupyterFrontEnd,
    awareness: Awareness,
    rmRegistry: IRenderMimeRegistry,
    drive: ICollaborativeDrive | null,
    themeManager: IThemeManager | null
  ): IChatFileType => {
    // Namespace for the tracker
    const namespace = 'chat';

    // Creating the tracker for the document
    const tracker = new WidgetTracker<CollaborativeChatWidget>({ namespace });

    const chatFileType: IChatFileType = {
      name: 'chat',
      displayName: 'Chat',
      mimeTypes: ['text/json', 'application/json'],
      extensions: ['.chat'],
      fileFormat: 'text',
      contentType: 'chat'
    };

    app.docRegistry.addFileType(chatFileType);

    if (drive) {
      const chatFactory = () => {
        return YChat.create();
      };
      drive.sharedModelFactory.registerDocumentFactory('chat', chatFactory);
    }

    // Creating and registering the model factory for our custom DocumentModel
    const modelFactory = new CollaborativeChatModelFactory({ awareness });
    app.docRegistry.addModelFactory(modelFactory);

    // Creating the widget factory to register it so the document manager knows about
    // our new DocumentWidget
    const widgetFactory = new ChatWidgetFactory({
      name: 'chat-factory',
      modelName: 'chat-model',
      fileTypes: ['chat'],
      defaultFor: ['chat'],
      themeManager,
      rmRegistry
    });

    // Add the widget to the tracker when it's created
    widgetFactory.widgetCreated.connect((sender, widget) => {
      // Notify the instance tracker if restore data needs to update.
      widget.context.pathChanged.connect(() => {
        tracker.save(widget);
      });
      tracker.add(widget);
    });

    // Registering the widget factory
    app.docRegistry.addWidgetFactory(widgetFactory);

    return chatFileType;
  }
};

/**
 * Extension providing a chat panel.
 */
export const chat: JupyterFrontEndPlugin<ChatPanel> = {
  id: pluginIds.chat,
  description: 'A chat extension for Jupyter',
  autoStart: true,
  provides: IChatPanel,
  requires: [
    IChatFileType,
    ICollaborativeDrive,
    IGlobalAwareness,
    IRenderMimeRegistry
  ],
  optional: [ILayoutRestorer, ISettingRegistry, IThemeManager],
  activate: (
    app: JupyterFrontEnd,
    chatFileType: IChatFileType,
    drive: ICollaborativeDrive,
    awareness: Awareness,
    rmRegistry: IRenderMimeRegistry,
    restorer: ILayoutRestorer | null,
    settingsRegistry: ISettingRegistry,
    themeManager: IThemeManager | null
  ): ChatPanel => {
    const { commands } = app;

    /**
     * Add Chat widget to left sidebar
     */
    const chatPanel = new ChatPanel({
      commands,
      drive,
      rmRegistry,
      themeManager
    });
    chatPanel.id = 'JupyterCollaborationChat:sidepanel';
    chatPanel.title.icon = chatIcon;
    chatPanel.title.caption = 'Jupyter Chat'; // TODO: i18n/

    app.shell.add(chatPanel, 'left', {
      rank: 2000
    });

    if (restorer) {
      restorer.add(chatPanel, 'jupyter-chat');
    }

    /**
     * Load the settings.
     */
    let sendWithShiftEnter = false;

    function loadSetting(setting: ISettingRegistry.ISettings): void {
      // Read the settings and convert to the correct type
      sendWithShiftEnter = setting.get('sendWithShiftEnter')
        .composite as boolean;
      chatPanel.config = { sendWithShiftEnter };
    }

    // Wait for the application to be restored and
    // for the settings to be loaded
    Promise.all([app.restored, settingsRegistry.load(pluginIds.chat)])
      .then(([, setting]) => {
        // Read the settings
        loadSetting(setting);

        // Listen for the plugin setting changes
        setting.changed.connect(loadSetting);
      })
      .catch(reason => {
        console.error(
          `Something went wrong when reading the settings.\n${reason}`
        );
      });

    /**
     * Command to create a new chat.
     */
    commands.addCommand(ChatPanel.CommandIDs.createChat, {
      label: 'New chat',
      caption: 'Create a new chat',
      icon: addIcon,
      execute: async args => {
        let filepath = (args.filepath as string) ?? '';
        if (!filepath) {
          let name: string | null = (args.name as string) ?? null;
          if (!name) {
            name = (
              await InputDialog.getText({
                label: 'Name',
                placeholder: 'untitled',
                title: 'Name of the chat'
              })
            ).value;
          }
          // no-op if the dialog has been cancelled
          // fill the filepath if the dialog has been validated with content
          // otherwise create a new untitled chat (empty filepath)
          if (name === null) {
            return;
          } else if (name) {
            filepath = `${name}${chatFileType.extensions[0]}`;
          }
        }
        commands.execute(ChatPanel.CommandIDs.openOrCreateChat, { filepath });
      }
    });

    /**
     * Command to open or create a chat.
     * It requires the 'filepath' argument.
     */
    commands.addCommand(ChatPanel.CommandIDs.openOrCreateChat, {
      label: 'Open or create a chat',
      execute: async args => {
        if (args.filepath === undefined) {
          console.error('Open or create a chat: filepath argument missing');
        }
        const filepath = args.filepath as string;
        let model: Contents.IModel | null = null;
        if (filepath) {
          model = await drive
            .get(filepath)
            .then(m => m)
            .catch(() => null);
        }

        if (!model) {
          // Create a new untitled chat
          model = await drive.newUntitled({
            type: 'file',
            ext: chatFileType.extensions[0]
          });
          // Rename it if a name has been provided
          if (filepath) {
            model = await drive.rename(model.path, filepath);
          }
          // Add an empty content in the file (empty JSON)
          model = await drive.save(model.path, {
            ...model,
            format: chatFileType.fileFormat,
            size: undefined,
            content: '{}'
          });
          // Open it again to ensure the file has been created.
          // TODO: Fix it, the previous steps should already ensure it.
          model = await drive
            .get(model.path)
            .then(m => m)
            .catch(() => null);
        }

        if (!model) {
          console.error('The chat file has not been created');
          return;
        }

        /**
         * Create a share model from the chat file
         */
        const sharedModel = drive.sharedModelFactory.createNew({
          path: model.path,
          format: model.format,
          contentType: chatFileType.contentType,
          collaborative: true
        }) as YChat;

        /**
         * Initialize the chat model with the share model
         */
        const chat = new CollaborativeChatModel({ awareness, sharedModel });

        /**
         * Add a chat widget to the side panel.
         */
        chatPanel.addChat(
          chat,
          PathExt.basename(model.name, chatFileType.extensions[0])
        );
      }
    });

    console.log('Collaborative chat initialized');

    return chatPanel;
  }
};

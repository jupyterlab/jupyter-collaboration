// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import { buildChatSidebar, buildErrorWidget } from '@jupyter/chat';
import { IChatFileType, IGlobalAwareness } from '@jupyter/collaboration';
import {
  CollaborativeChatModelFactory,
  ChatWidgetFactory,
  CollaborativeChat,
  CollaborativeChatModel,
  CollaborativeChatWidget,
  ICollaborativeDrive
} from '@jupyter/docprovider';
import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { IThemeManager, WidgetTracker } from '@jupyterlab/apputils';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Widget } from '@lumino/widgets';
import { Awareness } from 'y-protocols/awareness';

const pluginIds = {
  chatDocument: '@jupyter/collaboration-extension:chat-document',
  chat: '@jupyter/collaboration-extension:chat'
};

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
        return CollaborativeChat.create();
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
 * Initialization of the @jupyter/chat extension.
 */
export const chat: JupyterFrontEndPlugin<void> = {
  id: pluginIds.chat,
  description: 'A chat extension for Jupyter',
  autoStart: true,
  requires: [
    IChatFileType,
    ICollaborativeDrive,
    IGlobalAwareness,
    IRenderMimeRegistry
  ],
  optional: [ILayoutRestorer, ISettingRegistry, IThemeManager],
  activate: async (
    app: JupyterFrontEnd,
    chatFileType: IChatFileType,
    drive: ICollaborativeDrive,
    awareness: Awareness,
    rmRegistry: IRenderMimeRegistry,
    restorer: ILayoutRestorer | null,
    settingsRegistry: ISettingRegistry,
    themeManager: IThemeManager | null
  ) => {
    /**
     * Open or create a general chat file.
     */
    const generalChat = 'general.chat';
    let sendWithShiftEnter = false;

    const model = await drive
      .get(generalChat)
      .then(m => m)
      .catch(async () => {
        let m = await drive.newUntitled({
          type: 'file',
          ext: chatFileType.extensions[0]
        });
        m = await drive.rename(m.path, generalChat);
        m = await drive.save(m.path, {
          ...m,
          format: chatFileType.fileFormat,
          size: undefined,
          content: '{}'
        });
        return m;
      });

    /**
     * Create a share model from that chat file
     */
    const sharedModel = drive.sharedModelFactory.createNew({
      path: model.path,
      format: model.format,
      contentType: chatFileType.contentType,
      collaborative: true
    }) as CollaborativeChat;

    /**
     * Initialize the chat model with the share model
     */
    const chat = new CollaborativeChatModel({ awareness, sharedModel });

    /**
     * Load the settings.
     */
    function loadSetting(setting: ISettingRegistry.ISettings): void {
      // Read the settings and convert to the correct type
      sendWithShiftEnter = setting.get('sendWithShiftEnter')
        .composite as boolean;
      chat.config = { sendWithShiftEnter };
    }

    // Wait for the application to be restored and
    // for the settings for this plugin to be loaded
    Promise.all([app.restored, settingsRegistry.load(pluginIds.chat)])
      .then(([, setting]) => {
        // Read the settings
        loadSetting(setting);

        // Listen for your plugin setting changes using Signal
        setting.changed.connect(loadSetting);
      })
      .catch(reason => {
        console.error(
          `Something went wrong when reading the settings.\n${reason}`
        );
      });

    let chatWidget: Widget | null = null;
    try {
      chatWidget = buildChatSidebar(chat, themeManager, rmRegistry);
    } catch (e) {
      chatWidget = buildErrorWidget(themeManager);
    }

    /**
     * Add Chat widget to right sidebar
     */
    app.shell.add(chatWidget, 'left', { rank: 2000 });

    if (restorer) {
      restorer.add(chatWidget, 'jupyter-chat');
    }

    console.log('Collaborative chat initialized');
  }
};

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ReactWidget, IThemeManager } from '@jupyterlab/apputils';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import {
  buildChatSidebar,
  buildErrorWidget,
  ChatHandler,
  ChatService
} from '@jupyterlab/chat';
import { IGlobalAwareness } from '@jupyter/collaboration';
import { Awareness } from 'y-protocols/awareness';

/**
 * Initialization of the @jupyterlab/chat extension.
 */
export const chat: JupyterFrontEndPlugin<void> = {
  id: '@jupyterlab-extension:chat',
  description: 'A chat extension for Jupyterlab',
  autoStart: true,
  optional: [ILayoutRestorer, IThemeManager],
  requires: [IGlobalAwareness, IRenderMimeRegistry],
  activate: async (
    app: JupyterFrontEnd,
    awareness: Awareness,
    rmRegistry: IRenderMimeRegistry,
    restorer: ILayoutRestorer | null,
    themeManager: IThemeManager | null
  ) => {
    /**
     * Initialize chat handler, open WS connection
     */
    const chatHandler = new CollaborativeChatHandler({ awareness });

    let chatWidget: ReactWidget | null = null;
    try {
      await chatHandler.initialize();
      chatWidget = buildChatSidebar(chatHandler, themeManager, rmRegistry);
    } catch (e) {
      chatWidget = buildErrorWidget(themeManager);
    }

    /**
     * Add Chat widget to right sidebar
     */
    app.shell.add(chatWidget, 'left', { rank: 2000 });

    if (restorer) {
      restorer.add(chatWidget, 'jupyterlab-chat');
    }
    console.log('Collaboration chat initialized');
  }
};

/**
 * The collaborative chat handler.
 */
class CollaborativeChatHandler extends ChatHandler {
  /**
   * Create a new collaborative chat handler.
   */
  constructor(options: Private.IOptions) {
    super();
    this._awareness = options.awareness;
  }

  /**
   * A function called before transferring the message to the panel(s).
   * Can be useful if some actions are required on the message.
   *
   * It is used in this case to retrieve the user avatar color, unknown on server side.
   */
  protected formatChatMessage(
    message: ChatService.IChatMessage
  ): ChatService.IChatMessage {
    const sender = Array.from(this._awareness.states.values()).find(
      awareness => awareness.user.username === message.sender.username
    )?.user;
    if (sender) {
      message.sender.color = sender.color;
    }
    return message;
  }

  private _awareness: Awareness;
}

/**
 * The private namespace
 */
namespace Private {
  /**
   * Options for the collaborative chat handler.
   */
  export interface IOptions extends ChatHandler.IOptions {
    awareness: Awareness;
  }
}

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { User } from '@jupyterlab/services';
import { ITranslator } from '@jupyterlab/translation';
import { SidePanel } from '@jupyterlab/ui-components';
import { Panel } from '@lumino/widgets';

export class ChatPanel extends SidePanel {
  /**
   * The constructor of the panel.
   */
  constructor(options: ChatPanel.IOptions) {
    super({ content: new Panel(), translator: options.translator });
    this.addClass('jp-chatPanel');
  }
}

/**
 * The chat panel namespace.
 */
export namespace ChatPanel {
  /**
   * Options to use when building the chat panel.
   */
  export interface IOptions {
    currentUser: User.IManager;
    translator?: ITranslator;
  }
}

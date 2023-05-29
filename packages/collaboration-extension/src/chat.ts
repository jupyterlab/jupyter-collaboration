// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module chat-extension
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { DOMUtils } from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { ChatPanel } from '@jupyter/chat';

/**
 * The default collaborative chat panel.
 */
export const chat: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:chat',
  description: 'The default chat panel',
  requires: [ITranslator],
  optional: [],
  autoStart: true,
  activate: (app: JupyterFrontEnd, translator: ITranslator): void => {
    const { user } = app.serviceManager;
    const trans = (translator ?? nullTranslator).load('jupyter_collaboration');

    const panel = new ChatPanel({ translator, currentUser: user });
    panel.id = DOMUtils.createDomID();
    panel.title.caption = trans.__('Collaboration');
    app.shell.add(panel, 'right', { rank: 300 });
  }
};

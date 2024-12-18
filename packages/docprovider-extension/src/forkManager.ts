/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { ICollaborativeContentProvider } from '@jupyter/collaborative-drive';
import {
  ForkManager,
  IForkManager,
  IForkManagerToken
} from '@jupyter/docprovider';

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

export const forkManagerPlugin: JupyterFrontEndPlugin<IForkManager> = {
  id: '@jupyter/docprovider-extension:forkManager',
  autoStart: true,
  requires: [ICollaborativeContentProvider],
  provides: IForkManagerToken,
  activate: (
    app: JupyterFrontEnd,
    contentProvider: ICollaborativeContentProvider
  ) => {
    const eventManager = app.serviceManager.events;
    const manager = new ForkManager({ contentProvider, eventManager });
    return manager;
  }
};

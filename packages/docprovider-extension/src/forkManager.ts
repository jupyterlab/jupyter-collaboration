/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { ICollaborativeDrive } from '@jupyter/collaborative-drive';
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
  requires: [ICollaborativeDrive],
  provides: IForkManagerToken,
  activate: (app: JupyterFrontEnd, drive: ICollaborativeDrive) => {
    const eventManager = app.serviceManager.events;
    const manager = new ForkManager({ drive, eventManager });
    return manager;
  }
};

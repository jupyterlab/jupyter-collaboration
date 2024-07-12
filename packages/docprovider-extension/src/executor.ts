// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module docprovider-extension
 */

import { NotebookCellServerExecutor } from '@jupyter/docprovider';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { PageConfig } from '@jupyterlab/coreutils';
import { INotebookCellExecutor, runCell } from '@jupyterlab/notebook';

export const notebookCellExecutor: JupyterFrontEndPlugin<INotebookCellExecutor> =
  {
    id: '@jupyter/docprovider-extension:notebook-cell-executor',
    description:
      'Add notebook cell executor that uses REST API instead of kernel protocol over WebSocket.',
    autoStart: true,
    provides: INotebookCellExecutor,
    activate: (app: JupyterFrontEnd): INotebookCellExecutor => {
      if (PageConfig.getOption('serverSideExecution') === 'true') {
        return new NotebookCellServerExecutor({
          serverSettings: app.serviceManager.serverSettings
        });
      }
      return Object.freeze({ runCell });
    }
  };

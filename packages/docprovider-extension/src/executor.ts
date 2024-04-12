// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module docprovider-extension
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { PageConfig, URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

import { type MarkdownCell } from '@jupyterlab/cells';
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
        return Object.freeze({ runCell: runCellServerSide });
      }
      return Object.freeze({ runCell });
    }
  };

async function runCellServerSide({
  cell,
  notebook,
  notebookConfig,
  onCellExecuted,
  onCellExecutionScheduled,
  sessionContext,
  sessionDialogs,
  translator
}: INotebookCellExecutor.IRunCellOptions): Promise<boolean> {
  switch (cell.model.type) {
    case 'markdown':
      (cell as MarkdownCell).rendered = true;
      cell.inputHidden = false;
      onCellExecuted({ cell, success: true });
      break;
    case 'code': {
      const kernelId = sessionContext?.session?.kernel?.id;
      const settings = ServerConnection.makeSettings();
      const apiURL = URLExt.join(
        settings.baseUrl,
        `api/kernels/${kernelId}/execute`
      );
      const cellId = cell.model.sharedModel.getId();
      const documentId = `json:notebook:${notebook.sharedModel.getState(
        'file_id'
      )}`;
      const body = `{"cell_id":"${cellId}","document_id":"${documentId}"}`;
      const init = {
        method: 'POST',
        body
      };
      try {
        await ServerConnection.makeRequest(apiURL, init, settings);
      } catch (error: any) {
        throw new ServerConnection.NetworkError(error);
      }
      break;
    }
    default:
      break;
  }
  return Promise.resolve(true);
}

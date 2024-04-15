// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import { JupyterFrontEndPlugin } from '@jupyterlab/application';

import {
  drive,
  yfile,
  ynotebook,
  defaultFileBrowser,
  logger
} from './filebrowser';
import { notebookCellExecutor } from './executor';

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  drive,
  yfile,
  ynotebook,
  defaultFileBrowser,
  logger,
  notebookCellExecutor
];

export default plugins;

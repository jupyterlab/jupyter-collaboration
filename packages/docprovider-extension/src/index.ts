// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import { JupyterFrontEndPlugin } from '@jupyterlab/application';

import {
  logger,
  rtcContentProvider,
  statusBarTimeline
} from './filebrowser';
import { notebookCellExecutor } from './executor';

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  rtcContentProvider,
  logger,
  notebookCellExecutor,
  statusBarTimeline
];

export default plugins;

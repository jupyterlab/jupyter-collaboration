// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import { JupyterFrontEndPlugin } from '@jupyterlab/application';

import {
  rtcContentProvider,
  yfile,
  ynotebook,
  logger,
  statusBarTimeline
} from './filebrowser';
import { notebookCellExecutor } from './executor';
import { forkManagerPlugin } from './forkManager';

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<unknown>[] = [
  rtcContentProvider,
  yfile,
  ynotebook,
  logger,
  notebookCellExecutor,
  statusBarTimeline,
  forkManagerPlugin
];

export default plugins;

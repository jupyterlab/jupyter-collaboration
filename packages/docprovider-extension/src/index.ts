// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import {
  drive,
  yfile,
  ynotebook,
  defaultFileBrowser,
  logger,
  statusBarTimeline
} from './filebrowser';
import { notebookCellExecutor } from './executor';

/**
 * Export the plugins as default.
 */
export default [
  drive,
  yfile,
  ynotebook,
  defaultFileBrowser,
  logger,
  notebookCellExecutor,
  statusBarTimeline
];

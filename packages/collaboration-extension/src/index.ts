// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import { JupyterFrontEndPlugin } from '@jupyterlab/application';

import { drive, yfile, ynotebook, defaultFileBrowser } from './filebrowser';
import {
  userMenuPlugin,
  menuBarPlugin,
  rtcGlobalAwarenessPlugin,
  rtcPanelPlugin,
  userEditorCursors
} from './collaboration';

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  drive,
  yfile,
  ynotebook,
  defaultFileBrowser,
  userMenuPlugin,
  menuBarPlugin,
  rtcGlobalAwarenessPlugin,
  rtcPanelPlugin,
  userEditorCursors
];

export default plugins;

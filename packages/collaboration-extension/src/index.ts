// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/**
 * @packageDocumentation
 * @module collaboration-extension
 */

import { JupyterFrontEndPlugin } from '@jupyterlab/application';

import { chat, chatDocument } from './chat';
import {
  drive,
  yfile,
  ynotebook,
  defaultFileBrowser,
  logger
} from './filebrowser';
import {
  userMenuPlugin,
  menuBarPlugin,
  rtcGlobalAwarenessPlugin,
  rtcPanelPlugin,
  userEditorCursors
} from './collaboration';
import { sharedLink } from './sharedlink';

/**
 * Export the plugins as default.
 */
const plugins: JupyterFrontEndPlugin<any>[] = [
  chat,
  chatDocument,
  drive,
  yfile,
  ynotebook,
  defaultFileBrowser,
  logger,
  userMenuPlugin,
  menuBarPlugin,
  rtcGlobalAwarenessPlugin,
  rtcPanelPlugin,
  sharedLink,
  userEditorCursors
];

export default plugins;

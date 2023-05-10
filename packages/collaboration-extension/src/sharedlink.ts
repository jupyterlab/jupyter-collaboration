// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Clipboard, ICommandPalette } from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { shareIcon } from '@jupyterlab/ui-components';

import { showSharedLinkDialog } from '@jupyter/collaboration';

/**
 * The command IDs used by the plugin.
 */
namespace CommandIDs {
  export const share = 'collaboration:shared-link';
}

/**
 * Plugin to share the URL of the running Jupyter Server
 */
export const sharedLink: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:shared-link',
  autoStart: true,
  optional: [ICommandPalette, ITranslator],
  activate: async (
    app: JupyterFrontEnd,
    palette: ICommandPalette | null,
    translator: ITranslator | null
  ) => {
    const { commands } = app;
    const trans = (translator ?? nullTranslator).load('collaboration');

    commands.addCommand(CommandIDs.share, {
      label: trans.__('Generate a Shared Link'),
      icon: shareIcon,
      execute: async () => {
        const result = await showSharedLinkDialog({
          translator
        });
        if (result.button.accept && result.value) {
          Clipboard.copyToSystem(result.value);
        }
      }
    });

    if (palette) {
      palette.addItem({
        command: CommandIDs.share,
        category: trans.__('Server')
      });
    }
  }
};

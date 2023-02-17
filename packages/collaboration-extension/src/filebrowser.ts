import {
  ILabShell,
  IRouter,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  FileBrowser,
  IDefaultFileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';

import { CommandRegistry } from '@lumino/commands';

import { YDrive } from '@jupyter/docprovider';

/**
 * The command IDs used by the file browser plugin.
 */
namespace CommandIDs {
  export const openPath = 'filebrowser:open-path';
}

/**
 * The default file browser factory provider.
 */
export const defaultFileBrowser: JupyterFrontEndPlugin<IDefaultFileBrowser> = {
  id: '@jupyter/collaboration-extension:defaultFileBrowser',
  provides: IDefaultFileBrowser,
  requires: [IFileBrowserFactory],
  optional: [IRouter, JupyterFrontEnd.ITreeResolver, ILabShell],
  activate: async (
    app: JupyterFrontEnd,
    fileBrowserFactory: IFileBrowserFactory,
    router: IRouter | null,
    tree: JupyterFrontEnd.ITreeResolver | null,
    labShell: ILabShell | null
  ): Promise<IDefaultFileBrowser> => {
    console.debug(
      '@jupyter/collaboration-extension:defaultFileBrowser: activated'
    );
    const { commands } = app;

    const drive = new YDrive(app.serviceManager.user);
    app.serviceManager.contents.addDrive(drive);

    // Manually restore and load the default file browser.
    const defaultBrowser = fileBrowserFactory.createFileBrowser('filebrowser', {
      auto: false,
      restore: false,
      driveName: 'YDrive'
    });
    void Private.restoreBrowser(
      defaultBrowser,
      commands,
      router,
      tree,
      labShell
    );
    return defaultBrowser;
  }
};

namespace Private {
  /**
   * Restores file browser state and overrides state if tree resolver resolves.
   */
  export async function restoreBrowser(
    browser: FileBrowser,
    commands: CommandRegistry,
    router: IRouter | null,
    tree: JupyterFrontEnd.ITreeResolver | null,
    labShell: ILabShell | null
  ): Promise<void> {
    const restoring = 'jp-mod-restoring';

    browser.addClass(restoring);

    if (!router) {
      await browser.model.restore(browser.id);
      await browser.model.refresh();
      browser.removeClass(restoring);
      return;
    }

    const listener = async () => {
      router.routed.disconnect(listener);

      const paths = await tree?.paths;
      if (paths?.file || paths?.browser) {
        // Restore the model without populating it.
        await browser.model.restore(browser.id, false);
        if (paths.file) {
          await commands.execute(CommandIDs.openPath, {
            path: paths.file,
            dontShowBrowser: true
          });
        }
        if (paths.browser) {
          await commands.execute(CommandIDs.openPath, {
            path: paths.browser,
            dontShowBrowser: true
          });
        }
      } else {
        await browser.model.restore(browser.id);
        await browser.model.refresh();
      }
      browser.removeClass(restoring);

      if (labShell?.isEmpty('main')) {
        void commands.execute('launcher:create');
      }
    };
    router.routed.connect(listener);
  }
}

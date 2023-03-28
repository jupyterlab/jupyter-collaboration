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
import { ITranslator } from '@jupyterlab/translation';
import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { CommandRegistry } from '@lumino/commands';

import { YFile, YNotebook } from '@jupyter/ydoc';

import {
  ICollaborativeDrive,
  SharedDocumentFactory,
  YDrive
} from '@jupyter/docprovider';

/**
 * The command IDs used by the file browser plugin.
 */
namespace CommandIDs {
  export const openPath = 'filebrowser:open-path';
}

/**
 * The default file browser factory provider.
 */
export const drive: JupyterFrontEndPlugin<ICollaborativeDrive> = {
  id: '@jupyter/collaboration-extension:drive',
  provides: ICollaborativeDrive,
  requires: [ITranslator],
  optional: [],
  activate: (
    app: JupyterFrontEnd,
    translator: ITranslator
  ): ICollaborativeDrive => {
    const trans = translator.load('jupyter_collaboration');
    const drive = new YDrive(app.serviceManager.user, trans);
    app.serviceManager.contents.addDrive(drive);
    return drive;
  }
};

/**
 * The default file browser factory provider.
 */
export const yfile: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:yfile',
  autoStart: true,
  requires: [ICollaborativeDrive],
  optional: [],
  activate: (app: JupyterFrontEnd, drive: ICollaborativeDrive): void => {
    const yFileFactory: SharedDocumentFactory = () => {
      return new YFile();
    };
    drive.sharedModelFactory.registerDocumentFactory('file', yFileFactory);
  }
};

/**
 * The default file browser factory provider.
 */
export const ynotebook: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:ynotebook',
  autoStart: true,
  requires: [ICollaborativeDrive],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    drive: ICollaborativeDrive,
    settingRegistry: ISettingRegistry | null
  ): void => {
    let disableDocumentWideUndoRedo = true;

    // Fetch settings if possible.
    if (settingRegistry) {
      settingRegistry
        .load('@jupyterlab/notebook-extension:tracker')
        .then(settings => {
          const updateSettings = (settings: ISettingRegistry.ISettings) => {
            const enableDocWideUndo = settings?.get(
              'experimentalEnableDocumentWideUndoRedo'
            ).composite as boolean;

            disableDocumentWideUndoRedo = !enableDocWideUndo ?? true;
          };

          updateSettings(settings);
          settings.changed.connect((settings: ISettingRegistry.ISettings) =>
            updateSettings(settings)
          );
        });
    }

    const yNotebookFactory: SharedDocumentFactory = () => {
      return new YNotebook({
        disableDocumentWideUndoRedo
      });
    };
    drive.sharedModelFactory.registerDocumentFactory(
      'notebook',
      yNotebookFactory
    );
  }
};

/**
 * The default file browser factory provider.
 */
export const defaultFileBrowser: JupyterFrontEndPlugin<IDefaultFileBrowser> = {
  id: '@jupyter/collaboration-extension:defaultFileBrowser',
  provides: IDefaultFileBrowser,
  requires: [ICollaborativeDrive, IFileBrowserFactory],
  optional: [
    IRouter,
    JupyterFrontEnd.ITreeResolver,
    ILabShell,
    ISettingRegistry
  ],
  activate: async (
    app: JupyterFrontEnd,
    drive: ICollaborativeDrive,
    fileBrowserFactory: IFileBrowserFactory,
    router: IRouter | null,
    tree: JupyterFrontEnd.ITreeResolver | null,
    labShell: ILabShell | null
  ): Promise<IDefaultFileBrowser> => {
    const { commands } = app;

    app.serviceManager.contents.addDrive(drive);

    // Manually restore and load the default file browser.
    const defaultBrowser = fileBrowserFactory.createFileBrowser('filebrowser', {
      auto: false,
      restore: false,
      driveName: drive.name
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

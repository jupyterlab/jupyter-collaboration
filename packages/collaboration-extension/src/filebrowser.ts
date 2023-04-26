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
import { showDialog, Dialog } from '@jupyterlab/apputils';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ILogger, ILoggerRegistry } from '@jupyterlab/logconsole';
import { INotebookTracker } from '@jupyterlab/notebook';

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
 * The default collaborative drive provider.
 */
export const drive: JupyterFrontEndPlugin<ICollaborativeDrive> = {
  id: '@jupyter/collaboration-extension:drive',
  description: 'The default collaborative drive provider',
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
 * Plugin to register the shared model factory for the content type 'file'.
 */
export const yfile: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:yfile',
  description:
    "Plugin to register the shared model factory for the content type 'file'",
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
 * Plugin to register the shared model factory for the content type 'notebook'.
 */
export const ynotebook: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:ynotebook',
  description:
    "Plugin to register the shared model factory for the content type 'notebook'",
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
  description: 'The default file browser factory provider',
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

/**
 * The default collaborative drive provider.
 */
export const logger: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:logger',
  description: 'A logging plugin for debugging purposes.',
  autoStart: true,
  optional: [ILoggerRegistry, INotebookTracker, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    loggerRegistry: ILoggerRegistry | null,
    nbtracker: INotebookTracker | null,
    translator: ITranslator | null
  ): void => {
    const trans = (translator ?? nullTranslator).load('jupyter_collaboration');
    const schemaID =
      'https://events.jupyter.org/jupyter_server/jupyter_collaboration/v1';

    if (!loggerRegistry) {
      app.serviceManager.events.stream.connect((_, emission) => {
        if (emission.schema_id === schemaID) {
          console.debug(
            `[${emission.room}(${emission.path})] ${emission.action ?? ''}: ${
              emission.msg ?? ''
            }`
          );

          if (emission.level === 'WARNING') {
            showDialog({
              title: trans.__('Warning'),
              body: trans.__(
                `Two collaborative sessions are accessing the file ${emission.path} simultaneously.
                \nOpening the same file using different views simultaneously is not supported. Please, close one view; otherwise, you might lose some of your progress.`
              ),
              buttons: [Dialog.okButton()]
            });
          }
        }
      });

      return;
    }

    const loggers: Map<string, ILogger> = new Map();

    if (nbtracker) {
      nbtracker.widgetAdded.connect((sender, nb) => {
        const logger = loggerRegistry.getLogger(nb.context.path);
        loggers.set(nb.context.localPath, logger);

        nb.disposed.connect(nb => {
          loggers.delete(nb.context.localPath);
        });
      });
    }

    void (async () => {
      const { events } = app.serviceManager;
      for await (const emission of events.stream) {
        if (emission.schema_id === schemaID) {
          const logger = loggers.get(emission.path as string);

          logger?.log({
            type: 'text',
            level: (emission.level as string).toLowerCase() as any,
            data: `[${emission.room}] ${emission.action ?? ''}: ${
              emission.msg ?? ''
            }`
          });

          if (emission.level === 'WARNING') {
            showDialog({
              title: trans.__('Warning'),
              body: trans.__(
                `Two collaborative sessions are accessing the file ${emission.path} simultaneously.
                \nOpening the same file using different views simultaneously is not supported. Please, close one view; otherwise, you might lose some of your progress.`
              ),
              buttons: [Dialog.okButton()]
            });
          }
        }
      }
    })();
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

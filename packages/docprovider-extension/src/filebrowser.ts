/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import {
  ILabShell,
  IRouter,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { DocumentWidget, IDocumentWidget } from '@jupyterlab/docregistry';
import { Widget } from '@lumino/widgets';
import {
  FileBrowser,
  IDefaultFileBrowser,
  IFileBrowserFactory
} from '@jupyterlab/filebrowser';
import { IStatusBar } from '@jupyterlab/statusbar';

import { IEditorTracker } from '@jupyterlab/fileeditor';
import { ILogger, ILoggerRegistry } from '@jupyterlab/logconsole';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { CommandRegistry } from '@lumino/commands';

import { YFile, YNotebook } from '@jupyter/ydoc';

import {
  ICollaborativeDrive,
  IGlobalAwareness
} from '@jupyter/collaborative-drive';
import { IForkProvider, TimelineWidget, YDrive } from '@jupyter/docprovider';
import { Awareness } from 'y-protocols/awareness';
import { URLExt } from '@jupyterlab/coreutils';

/**
 * The command IDs used by the file browser plugin.
 */
namespace CommandIDs {
  export const openPath = 'filebrowser:open-path';
}
const DOCUMENT_TIMELINE_URL = 'api/collaboration/timeline';

/**
 * The default collaborative drive provider.
 */
export const drive: JupyterFrontEndPlugin<ICollaborativeDrive> = {
  id: '@jupyter/docprovider-extension:drive',
  description: 'The default collaborative drive provider',
  provides: ICollaborativeDrive,
  requires: [ITranslator],
  optional: [IGlobalAwareness],
  activate: (
    app: JupyterFrontEnd,
    translator: ITranslator,
    globalAwareness: Awareness | null
  ): ICollaborativeDrive => {
    const trans = translator.load('jupyter_collaboration');
    const drive = new YDrive(app.serviceManager.user, trans, globalAwareness);
    app.serviceManager.contents.addDrive(drive);
    return drive;
  }
};

/**
 * Plugin to register the shared model factory for the content type 'file'.
 */
export const yfile: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/docprovider-extension:yfile',
  description:
    "Plugin to register the shared model factory for the content type 'file'",
  autoStart: true,
  requires: [ICollaborativeDrive],
  optional: [],
  activate: (app: JupyterFrontEnd, drive: ICollaborativeDrive): void => {
    const yFileFactory = () => {
      return new YFile();
    };
    drive.sharedModelFactory.registerDocumentFactory('file', yFileFactory);
  }
};

/**
 * Plugin to register the shared model factory for the content type 'notebook'.
 */
export const ynotebook: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/docprovider-extension:ynotebook',
  description:
    "Plugin to register the shared model factory for the content type 'notebook'",
  autoStart: true,
  requires: [ICollaborativeDrive],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    drive: YDrive,
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

    const yNotebookFactory = () => {
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
 * A plugin to add a timeline slider status item to the status bar.
 */
export const statusBarTimeline: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/docprovider-extension:statusBarTimeline',
  description: 'Plugin to add a timeline slider to the status bar',
  autoStart: true,
  requires: [IStatusBar, ICollaborativeDrive],
  activate: async (
    app: JupyterFrontEnd,
    statusBar: IStatusBar,
    drive: ICollaborativeDrive
  ): Promise<void> => {
    try {
      let sliderItem: Widget | null = null;
      let timelineWidget: TimelineWidget | null = null;

      const updateTimelineForDocument = async (
        documentPath: string,
        documentId: string
      ) => {
        if (drive) {
          // Remove 'RTC:' from document path
          documentPath = documentPath.slice(drive.name.length + 1);
          // Dispose of the previous timelineWidget if it exists
          if (timelineWidget) {
            timelineWidget.dispose();
            timelineWidget = null;
          }

          const [format, type] = documentId.split(':');
          const provider = drive.providers.get(
            `${format}:${type}:${documentPath}`
          ) as unknown as IForkProvider;
          const fullPath = URLExt.join(
            app.serviceManager.serverSettings.baseUrl,
            DOCUMENT_TIMELINE_URL,
            documentPath
          );

          timelineWidget = new TimelineWidget(
            fullPath,
            provider,
            provider.contentType,
            provider.format
          );

          const elt = document.getElementById('jp-slider-status-bar');
          if (elt && !timelineWidget.isAttached) {
            Widget.attach(timelineWidget, elt);
          }
        }
      };

      if (app.shell.currentChanged) {
        app.shell.currentChanged.connect(async (_, args) => {
          const currentWidget = args.newValue as DocumentWidget;
          if (timelineWidget) {
            // Dispose of the timelineWidget when the document is closed
            timelineWidget.dispose();
            timelineWidget = null;
          }
          if (currentWidget && 'context' in currentWidget) {
            await currentWidget.context.ready;
            await updateTimelineForDocument(
              currentWidget.context.path,
              currentWidget.context.model.sharedModel.getState(
                'document_id'
              ) as string
            );
          }
        });
      }

      if (statusBar) {
        if (!sliderItem) {
          sliderItem = new Widget();
          sliderItem.addClass('jp-StatusBar-GroupItem');
          sliderItem.addClass('jp-mod-highlighted');
          sliderItem.id = 'jp-slider-status-bar';
          statusBar.registerStatusItem('jp-slider-status-bar', {
            item: sliderItem,
            align: 'left',
            rank: 4,
            isActive: () => {
              const currentWidget = app.shell.currentWidget;
              return !!currentWidget && 'context' in currentWidget;
            }
          });
        }
      }
    } catch (error) {
      console.error('Failed to activate statusBarTimeline plugin:', error);
    }
  }
};

/**
 * The default file browser factory provider.
 */
export const defaultFileBrowser: JupyterFrontEndPlugin<IDefaultFileBrowser> = {
  id: '@jupyter/docprovider-extension:defaultFileBrowser',
  description: 'The default file browser factory provider',
  provides: IDefaultFileBrowser,
  requires: [ICollaborativeDrive, IFileBrowserFactory],
  optional: [IRouter, JupyterFrontEnd.ITreeResolver, ILabShell, ITranslator],
  activate: async (
    app: JupyterFrontEnd,
    drive: YDrive,
    fileBrowserFactory: IFileBrowserFactory,
    router: IRouter | null,
    tree: JupyterFrontEnd.ITreeResolver | null,
    labShell: ILabShell | null,
    translator: ITranslator | null
  ): Promise<IDefaultFileBrowser> => {
    const { commands } = app;
    const trans = (translator ?? nullTranslator).load('jupyterlab');
    app.serviceManager.contents.addDrive(drive);

    // Manually restore and load the default file browser.
    const defaultBrowser = fileBrowserFactory.createFileBrowser('filebrowser', {
      auto: false,
      restore: false,
      driveName: drive.name
    });
    defaultBrowser.node.setAttribute('role', 'region');
    defaultBrowser.node.setAttribute(
      'aria-label',
      trans.__('File Browser Section')
    );

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
  id: '@jupyter/docprovider-extension:logger',
  description: 'A logging plugin for debugging purposes.',
  autoStart: true,
  optional: [ILoggerRegistry, IEditorTracker, INotebookTracker, ITranslator],
  activate: (
    app: JupyterFrontEnd,
    loggerRegistry: ILoggerRegistry | null,
    fileTracker: IEditorTracker | null,
    nbTracker: INotebookTracker | null,
    translator: ITranslator | null
  ): void => {
    const trans = (translator ?? nullTranslator).load('jupyter_collaboration');
    const schemaID =
      'https://schema.jupyter.org/jupyter_collaboration/session/v1';

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

    const addLogger = (sender: unknown, document: IDocumentWidget) => {
      const logger = loggerRegistry.getLogger(document.context.path);
      loggers.set(document.context.localPath, logger);

      document.disposed.connect(document => {
        loggers.delete(document.context.localPath);
      });
    };

    if (fileTracker) {
      fileTracker.widgetAdded.connect(addLogger);
    }

    if (nbTracker) {
      nbTracker.widgetAdded.connect(addLogger);
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
                `Two collaborative sessions are accessing the file %1 simultaneously.
                \nOpening a document with multiple views simultaneously is not supported. Please close one view; otherwise, you might lose some of your progress.`,
                emission.path
              ),
              buttons: [Dialog.warnButton({ label: trans.__('Ok') })]
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

/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { Drive } from '@jupyterlab/services';
import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { DocumentWidget, IDocumentWidget } from '@jupyterlab/docregistry';
import { Widget } from '@lumino/widgets';
import { IStatusBar } from '@jupyterlab/statusbar';
import { IEditorTracker } from '@jupyterlab/fileeditor';
import { ILogger, ILoggerRegistry } from '@jupyterlab/logconsole';
import { INotebookTracker } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { YFile, YNotebook } from '@jupyter/ydoc';

import {
  IForkProvider,
  IGlobalAwareness,
  TimelineWidget,
  RtcContentProvider
} from '@jupyter/docprovider';
import { Awareness } from 'y-protocols/awareness';
import { URLExt } from '@jupyterlab/coreutils';

/**
 * The RTC content provider.
 */
const DOCUMENT_TIMELINE_URL = 'api/collaboration/timeline';

export const rtcContentProvider: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/docprovider-extension:content',
  description: 'The RTC content provider',
  autoStart: true,
  requires: [ITranslator],
  optional: [IGlobalAwareness, ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    translator: ITranslator,
    globalAwareness: Awareness | null,
    settingRegistry: ISettingRegistry | null
  ): void => {
    const trans = translator.load('jupyter_collaboration');
    const rtcContentProvider = new RtcContentProvider(app.serviceManager.user, trans, globalAwareness);

    const yFileFactory = () => {
      return new YFile();
    };
    rtcContentProvider.sharedModelFactory.registerDocumentFactory('file', yFileFactory);

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
    rtcContentProvider.sharedModelFactory.registerDocumentFactory(
      'notebook',
      yNotebookFactory
    );

    Drive.getContentProviderRegistry().register(rtcContentProvider);
  }
};

/**
 * A plugin to add a timeline slider status item to the status bar.
 */
export const statusBarTimeline: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/docprovider-extension:statusBarTimeline',
  description: 'Plugin to add a timeline slider to the status bar',
  autoStart: true,
  requires: [IStatusBar],
  activate: async (
    app: JupyterFrontEnd,
    statusBar: IStatusBar
  ): Promise<void> => {
    try {
      let sliderItem: Widget | null = null;
      let timelineWidget: TimelineWidget | null = null;

      if (app.shell.currentChanged) {
        app.shell.currentChanged.connect(async (_, args) => {
          const currentWidget = args.newValue as DocumentWidget;
          if (timelineWidget) {
            // Dispose of the timelineWidget when the document is closed
            timelineWidget.dispose();
            timelineWidget = null;
          }
          if (currentWidget && 'context' in currentWidget) {
            // FIXME
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

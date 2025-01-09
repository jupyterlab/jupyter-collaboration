/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Dialog, showDialog } from '@jupyterlab/apputils';
import { DocumentWidget, IDocumentWidget } from '@jupyterlab/docregistry';
import { Widget } from '@lumino/widgets';

import { IStatusBar } from '@jupyterlab/statusbar';
import { ContentsManager } from '@jupyterlab/services';

import {
  IEditorTracker,
  IEditorWidgetFactory,
  FileEditorFactory
} from '@jupyterlab/fileeditor';
import { ILogger, ILoggerRegistry } from '@jupyterlab/logconsole';
import {
  INotebookTracker,
  INotebookWidgetFactory,
  NotebookWidgetFactory
} from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ITranslator, nullTranslator } from '@jupyterlab/translation';

import { YFile, YNotebook } from '@jupyter/ydoc';

import {
  ICollaborativeContentProvider,
  IGlobalAwareness
} from '@jupyter/collaborative-drive';
import {
  IForkProvider,
  TimelineWidget,
  RtcContentProvider
} from '@jupyter/docprovider';
import { Awareness } from 'y-protocols/awareness';
import { URLExt } from '@jupyterlab/coreutils';

const DOCUMENT_TIMELINE_URL = 'api/collaboration/timeline';

const TWO_SESSIONS_WARNING =
  'The file %1 has been opened with two different views. ' +
  'This is not supported. Please close this view; otherwise, ' +
  'some of your edits may not be saved properly.';

export const rtcContentProvider: JupyterFrontEndPlugin<ICollaborativeContentProvider> =
  {
    id: '@jupyter/docprovider-extension:content-provider',
    description: 'The RTC content provider',
    provides: ICollaborativeContentProvider,
    requires: [ITranslator],
    optional: [IGlobalAwareness],
    activate: (
      app: JupyterFrontEnd,
      translator: ITranslator,
      globalAwareness: Awareness | null
    ): ICollaborativeContentProvider => {
      const trans = translator.load('jupyter_collaboration');
      const defaultDrive = (app.serviceManager.contents as ContentsManager)
        .defaultDrive;
      if (!defaultDrive) {
        throw Error(
          'Cannot initialize content provider: default drive property not accessible on contents manager instance.'
        );
      }
      const registry = defaultDrive.contentProviderRegistry;
      if (!registry) {
        throw Error(
          'Cannot initialize content provider: no content provider registry.'
        );
      }
      const rtcContentProvider = new RtcContentProvider({
        apiEndpoint: '/api/contents',
        serverSettings: defaultDrive.serverSettings,
        user: app.serviceManager.user,
        trans,
        globalAwareness
      });
      registry.register('rtc', rtcContentProvider);
      return rtcContentProvider;
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
  requires: [ICollaborativeContentProvider, IEditorWidgetFactory],
  activate: (
    app: JupyterFrontEnd,
    contentProvider: ICollaborativeContentProvider,
    editorFactory: FileEditorFactory.IFactory
  ): void => {
    const yFileFactory = () => {
      return new YFile();
    };
    contentProvider.sharedModelFactory.registerDocumentFactory(
      'file',
      yFileFactory
    );
    editorFactory.contentProviderId = 'rtc';
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
  requires: [ICollaborativeContentProvider, INotebookWidgetFactory],
  optional: [ISettingRegistry],
  activate: (
    app: JupyterFrontEnd,
    contentProvider: ICollaborativeContentProvider,
    notebookFactory: NotebookWidgetFactory.IFactory,
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
    contentProvider.sharedModelFactory.registerDocumentFactory(
      'notebook',
      yNotebookFactory
    );
    notebookFactory.contentProviderId = 'rtc';
  }
};
/**
 * A plugin to add a timeline slider status item to the status bar.
 */
export const statusBarTimeline: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/docprovider-extension:statusBarTimeline',
  description: 'Plugin to add a timeline slider to the status bar',
  autoStart: true,
  requires: [IStatusBar, ICollaborativeContentProvider],
  activate: async (
    app: JupyterFrontEnd,
    statusBar: IStatusBar,
    contentProvider: ICollaborativeContentProvider
  ): Promise<void> => {
    try {
      let sliderItem: Widget | null = null;
      let timelineWidget: TimelineWidget | null = null;

      const updateTimelineForDocument = async (
        documentPath: string,
        documentId: string
      ) => {
        if (!documentId) {
          return;
        }
        // Dispose of the previous timelineWidget if it exists
        if (timelineWidget) {
          timelineWidget.dispose();
          timelineWidget = null;
        }

        const [format, type] = documentId.split(':');
        const provider = contentProvider.providers.get(
          `${format}:${type}:${documentPath}`
        );
        if (!provider) {
          // this can happen for documents which are not provisioned with RTC
          return;
        }

        const forkProvider = provider as unknown as IForkProvider;

        const fullPath = URLExt.join(
          app.serviceManager.serverSettings.baseUrl,
          DOCUMENT_TIMELINE_URL,
          documentPath
        );

        timelineWidget = new TimelineWidget(
          fullPath,
          forkProvider,
          forkProvider.contentType,
          forkProvider.format,
          DOCUMENT_TIMELINE_URL
        );

        const elt = document.getElementById('jp-slider-status-bar');
        if (elt && !timelineWidget.isAttached) {
          Widget.attach(timelineWidget, elt);
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
              const currentWidget = app.shell
                .currentWidget as DocumentWidget | null;

              return currentWidget?.context?.model?.collaborative || false;
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
              body: trans.__(TWO_SESSIONS_WARNING, emission.path),
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
              body: trans.__(TWO_SESSIONS_WARNING, emission.path),
              buttons: [Dialog.warnButton({ label: trans.__('Ok') })]
            });
          }
        }
      }
    })();
  }
};

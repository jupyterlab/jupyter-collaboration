// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { URLExt } from '@jupyterlab/coreutils';
import { DocumentWidget } from '@jupyterlab/docregistry';
import { IStatusBar } from '@jupyterlab/statusbar';
import { Widget } from '@lumino/widgets';

import { TimelineWidget } from '@jupyter/collaboration';
import { ICollaborativeContentProvider } from '@jupyter/collaborative-drive';
import { IForkProvider } from '@jupyter/docprovider';

const DOCUMENT_TIMELINE_URL = 'api/collaboration/timeline';

/**
 * A plugin to add a timeline slider status item to the status bar.
 */
export const statusBarTimeline: JupyterFrontEndPlugin<void> = {
  id: '@jupyter/collaboration-extension:statusBarTimeline',
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
          DOCUMENT_TIMELINE_URL,
          app.serviceManager.serverSettings
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

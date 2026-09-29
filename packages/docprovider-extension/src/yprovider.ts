/* -----------------------------------------------------------------------------
| Copyright (c) Jupyter Development Team.
| Distributed under the terms of the Modified BSD License.
|----------------------------------------------------------------------------*/

import { ITranslator, TranslationBundle } from '@jupyterlab/translation';

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  WebSocketProvider,
  WebSocketAwarenessProvider,
  IAwarenessProviderFactory,
  IDocumentProviderFactory
} from '@jupyter/docprovider';

import { URLExt } from '@jupyterlab/coreutils';
import { MainAreaWidget, ToolbarButton } from '@jupyterlab/apputils';
import { saveIcon, undoIcon } from '@jupyterlab/ui-components';
import { CodeEditor, IEditorServices } from '@jupyterlab/codeeditor';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';

import { JSONValue, UUID } from '@lumino/coreutils';

import type * as nbformat from '@jupyterlab/nbformat';

import { ConflictDiffWidget } from './conflictDiffWidget';
import { CommandRegistry } from '@lumino/commands';
import { Widget } from '@lumino/widgets';

/**
 * The plugin ID for settings.
 */
const PLUGIN_ID = '@jupyter/docprovider-extension:websocket-provider';

/**
 * Document provider factory that creates WebSocket providers.
 */
class WebSocketDocumentProviderFactory implements IDocumentProviderFactory {
  constructor(options: WebSocketDocumentProviderFactory.IOptions) {
    this._trans = options.translator;
    this._commands = options.commands;
    this._docManager = options.docManager;
    this._shell = options.shell;
    this._contents = options.contents;
    this._editorFactory = options.editorFactory;
    this._rendermime = options.rendermime;
  }

  create(options: IDocumentProviderFactory.IOptions) {
    const shell = this._shell;
    const contents = this._contents;
    const editorFactory = this._editorFactory;
    const rendermime = this._rendermime;
    const path = options.path;

    const onConflictShowNotebookDiff = async (localContent: JSONValue) => {
      const serverModel = await contents.get(path, { content: true });
      const widget = new ConflictDiffWidget({
        translator: this._trans,
        editorFactory,
        rendermime
      });
      await widget.create({
        base: serverModel.content as nbformat.INotebookContent,
        remote: localContent as nbformat.INotebookContent
      });
      const main = new MainAreaWidget({ content: widget });
      main.title.label = this._trans.__('Conflict diff: %1', path);
      main.title.closable = true;
      main.toolbar.addItem(
        'revertToRemote',
        new ToolbarButton({
          icon: undoIcon,
          label: this._trans.__('Revert to Remote'),
          tooltip: this._trans.__(
            'Discard local changes and reload the server version'
          ),
          onClick: () => {
            const context = this._docManager.findWidget(path)?.context;
            if (context && !context.isDisposed) {
              void context.revert();
            }
          }
        })
      );
      main.toolbar.addItem(
        'saveLocalAs',
        new ToolbarButton({
          icon: saveIcon,
          label: this._trans.__('Save Local As'),
          tooltip: this._trans.__('Save the local version with a new name'),
          onClick: () => {
            const context = this._docManager.findWidget(path)?.context;
            if (context && !context.isDisposed) {
              void context.saveAs();
            }
          }
        })
      );
      shell.add(main, 'main');
      shell.activateById(main.id);
    };

    return new WebSocketProvider({
      path,
      contentType: options.contentType,
      format: options.format,
      model: options.model,
      user: options.user,
      translator: this._trans,
      serverSettings: options.serverSettings,
      onCloseDocument: () => {
        const views = Array.from(shell.widgets('main')).filter(
          widget =>
            this._docManager.contextForWidget(widget)?.model.sharedModel ===
            options.model
        );
        const current = shell.currentWidget;
        const view = views.find(widget => widget === current) ?? views[0];
        view?.dispose();
      },
      onSwitchDocument: async newPath => {
        const views = Array.from(shell.widgets('main')).filter(
          widget =>
            this._docManager.contextForWidget(widget)?.model.sharedModel ===
            options.model
        );
        const current = shell.currentWidget;
        const view = views.find(widget => widget === current) ?? views[0];
        if (!view) {
          return;
        }
        // Keep the replacement at this tab's position. Dispose this client's
        // context before opening the same path, so it cannot reuse the old room.
        const placeholder = new Widget();
        placeholder.id = `jp-external-change-${UUID.uuid4()}`;
        placeholder.title.label = view.title.label;
        shell.add(placeholder, 'main', { mode: 'tab-before', ref: view.id });
        const context = this._docManager.contextForWidget(view);
        context?.dispose();
        views.forEach(widget => widget.dispose());
        try {
          const replacement = this._docManager.open(
            newPath,
            options.contentType === 'notebook' ? 'Notebook' : 'Editor',
            undefined,
            { mode: 'tab-after', ref: placeholder.id }
          );
          if (!replacement) {
            throw new Error(this._trans.__('Could not open %1', newPath));
          }
          await replacement.context.ready;
        } finally {
          placeholder.dispose();
        }
      },
      onConflictSaveAs: () => this._commands.execute('docmanager:save-as'),
      onConflictRevert: () => this._commands.execute('docmanager:reload'),
      // The diff view is notebook-specific (uses nbdime), so only offer it
      // when the document being opened is a notebook.
      onConflictShowDiff:
        options.contentType === 'notebook'
          ? onConflictShowNotebookDiff
          : undefined
    });
  }
  private _trans: TranslationBundle;
  private _commands: CommandRegistry;
  private _docManager: IDocumentManager;
  private _shell: JupyterFrontEnd.IShell;
  private _contents: Contents.IManager;
  private _editorFactory: CodeEditor.Factory;
  private _rendermime: IRenderMimeRegistry;
}

namespace WebSocketDocumentProviderFactory {
  export interface IOptions {
    translator: TranslationBundle;
    commands: CommandRegistry;
    docManager: IDocumentManager;
    shell: JupyterFrontEnd.IShell;
    contents: Contents.IManager;
    editorFactory: CodeEditor.Factory;
    rendermime: IRenderMimeRegistry;
  }
}

/**
 * Awareness provider factory that creates WebSocket awareness providers.
 */
class WebSocketAwarenessProviderFactory implements IAwarenessProviderFactory {
  create(options: IAwarenessProviderFactory.IOptions) {
    const url = URLExt.join(
      options.serverSettings.wsUrl,
      'api/collaboration/room'
    );
    return new WebSocketAwarenessProvider({
      url,
      roomID: options.roomID,
      awareness: options.awareness,
      user: options.user
    });
  }
}

/**
 * Plugin that provides the WebSocket document provider factory.
 */
export const documentProviderFactoryPlugin: JupyterFrontEndPlugin<IDocumentProviderFactory> =
  {
    id: PLUGIN_ID + '-document-factory',
    description: 'Provides a WebSocket document provider factory.',
    requires: [
      ITranslator,
      IEditorServices,
      IRenderMimeRegistry,
      IDocumentManager
    ],
    optional: [],
    provides: IDocumentProviderFactory,
    activate: async (
      app: JupyterFrontEnd,
      translator: ITranslator,
      editorServices: IEditorServices,
      rendermime: IRenderMimeRegistry,
      docManager: IDocumentManager
    ) => {
      const trans = translator.load('jupyter_collaboration');
      return new WebSocketDocumentProviderFactory({
        translator: trans,
        commands: app.commands,
        docManager,
        shell: app.shell,
        contents: app.serviceManager.contents,
        editorFactory: editorServices.factoryService.newInlineEditor,
        rendermime
      });
    }
  };

/**
 * Plugin that provides the WebSocket awareness provider factory.
 */
export const awarenessProviderFactoryPlugin: JupyterFrontEndPlugin<IAwarenessProviderFactory> =
  {
    id: PLUGIN_ID + '-awareness-factory',
    description: 'Provides awareness provider factory.',
    requires: [],
    optional: [],
    provides: IAwarenessProviderFactory,
    activate: async (app: JupyterFrontEnd) => {
      return new WebSocketAwarenessProviderFactory();
    }
  };

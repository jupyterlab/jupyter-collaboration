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
import { MainAreaWidget } from '@jupyterlab/apputils';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { IRenderMimeRegistry } from '@jupyterlab/rendermime';
import { Contents } from '@jupyterlab/services';

import { JSONValue } from '@lumino/coreutils';

import type * as nbformat from '@jupyterlab/nbformat';

import { ConflictDiffWidget } from './conflictDiffWidget';

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

    return new WebSocketProvider({
      path,
      contentType: options.contentType,
      format: options.format,
      model: options.model,
      user: options.user,
      translator: this._trans,
      serverSettings: options.serverSettings,
      onConflictSaveAs: () => this._commands.execute('docmanager:save-as'),
      onConflictRevert: () => this._commands.execute('docmanager:reload'),
      onConflictShowDiff: async (localContent: JSONValue) => {
        const serverModel = await contents.get(path, { content: true });
        const widget = await ConflictDiffWidget.create({
          base: serverModel.content as nbformat.INotebookContent,
          remote: localContent as nbformat.INotebookContent,
          editorFactory,
          rendermime
        });
        const main = new MainAreaWidget({ content: widget });
        main.title.label = this._trans.__('Conflict diff: %1', path);
        main.title.closable = true;
        shell.add(main, 'main');
        shell.activateById(main.id);
      }
    });
  }
  private _trans: TranslationBundle;
  private _commands: JupyterFrontEnd['commands'];
  private _shell: JupyterFrontEnd['shell'];
  private _contents: Contents.IManager;
  private _editorFactory: IEditorServices['factoryService']['newInlineEditor'];
  private _rendermime: IRenderMimeRegistry;
}

namespace WebSocketDocumentProviderFactory {
  export interface IOptions {
    translator: TranslationBundle;
    commands: JupyterFrontEnd['commands'];
    shell: JupyterFrontEnd['shell'];
    contents: Contents.IManager;
    editorFactory: IEditorServices['factoryService']['newInlineEditor'];
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
    requires: [ITranslator, IEditorServices, IRenderMimeRegistry],
    optional: [],
    provides: IDocumentProviderFactory,
    activate: async (
      app: JupyterFrontEnd,
      translator: ITranslator,
      editorServices: IEditorServices,
      rendermime: IRenderMimeRegistry
    ) => {
      const trans = translator.load('jupyter_collaboration');
      return new WebSocketDocumentProviderFactory({
        translator: trans,
        commands: app.commands,
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

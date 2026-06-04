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
  }

  create(options: IDocumentProviderFactory.IOptions) {
    return new WebSocketProvider({
      path: options.path,
      contentType: options.contentType,
      format: options.format,
      model: options.model,
      user: options.user,
      translator: this._trans,
      serverSettings: options.serverSettings,
      onConflictSaveAs: () => this._commands.execute('docmanager:save-as'),
      onConflictRevert: () => this._commands.execute('docmanager:reload')
    });
  }
  private _trans: TranslationBundle;
  private _commands: JupyterFrontEnd['commands'];
}

namespace WebSocketDocumentProviderFactory {
  export interface IOptions {
    translator: TranslationBundle;
    commands: JupyterFrontEnd['commands'];
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
    requires: [ITranslator],
    optional: [],
    provides: IDocumentProviderFactory,
    activate: async (app: JupyterFrontEnd, translator: ITranslator) => {
      const trans = translator.load('jupyter_collaboration');
      return new WebSocketDocumentProviderFactory({
        translator: trans,
        commands: app.commands
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

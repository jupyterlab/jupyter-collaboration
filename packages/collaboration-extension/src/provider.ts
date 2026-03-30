// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { ServerConnection, User } from '@jupyterlab/services';
import { ITranslator, TranslationBundle } from '@jupyterlab/translation';
import {
  IAwarenessProviderFactory,
  IDocumentProviderFactory,
  IDocumentProviderFactoryToken,
  IAwarenessProviderFactoryToken,
  WebRTCProvider,
  WebSocketProvider,
  WebRTCAwarenessProvider,
  WebSocketAwarenessProvider
} from '@jupyter/docprovider';
import { URLExt } from '@jupyterlab/coreutils';

/**
 * The plugin ID for settings.
 */
const PLUGIN_ID = '@jupyter/collaboration-extension:provider';

/**
 * Load the provider type from settings.
 */
async function loadProviderType(
  settingRegistry: ISettingRegistry
): Promise<'websocket' | 'webrtc'> {
  try {
    const settings = await settingRegistry.load(PLUGIN_ID);
    return settings.get('provider').composite as 'websocket' | 'webrtc';
  } catch (error) {
    console.warn('Failed to load provider settings, using default.', error);
    return 'websocket';
  }
}

/**
 * Document provider factory that respects the setting.
 */
class SettingBasedDocumentProviderFactory implements IDocumentProviderFactory {
  constructor(
    private _providerType: 'websocket' | 'webrtc',
    private _user: User.IManager,
    private _trans: TranslationBundle
  ) {}

  create(options: IDocumentProviderFactory.IOptions) {
    const providerOptions = {
      path: options.path,
      contentType: options.contentType,
      format: options.format,
      model: options.model,
      user: this._user,
      translator: this._trans,
      serverSettings: options.serverSettings,
      roomIdType: options.roomIdType,
      drive: options.drive
    };

    if (this._providerType === 'webrtc') {
      return new WebRTCProvider(providerOptions);
    } else {
      return new WebSocketProvider(providerOptions);
    }
  }
}

/**
 * Awareness provider factory that respects the setting.
 */
class SettingBasedAwarenessProviderFactory
  implements IAwarenessProviderFactory
{
  constructor(
    private _providerType: 'websocket' | 'webrtc',
    private _user: User.IManager,
    private _serverSettings: ServerConnection.ISettings
  ) {}

  create(options: IAwarenessProviderFactory.IOptions) {
    if (this._providerType === 'webrtc') {
      return new WebRTCAwarenessProvider({
        roomID: options.roomID,
        awareness: options.awareness,
        user: this._user,
        serverSettings: this._serverSettings
      });
    } else {
      const url = URLExt.join(
        this._serverSettings.wsUrl,
        'api/collaboration/room'
      );
      return new WebSocketAwarenessProvider({
        url,
        roomID: options.roomID,
        awareness: options.awareness,
        user: this._user
      });
    }
  }
}

/**
 * Plugin that provides the document provider factory.
 */
export const documentProviderFactoryPlugin: JupyterFrontEndPlugin<IDocumentProviderFactory> =
  {
    id: PLUGIN_ID + ':document-factory',
    description: 'Provides document provider factory based on setting.',
    requires: [ISettingRegistry, ITranslator],
    optional: [],
    provides: IDocumentProviderFactoryToken,
    activate: async (
      app: JupyterFrontEnd,
      settingRegistry: ISettingRegistry,
      translator: ITranslator
    ) => {
      const { user } = app.serviceManager;
      const trans = translator.load('jupyter_collaboration');
      const providerType = await loadProviderType(settingRegistry);
      return new SettingBasedDocumentProviderFactory(providerType, user, trans);
    }
  };

/**
 * Plugin that provides the awareness provider factory.
 */
export const awarenessProviderFactoryPlugin: JupyterFrontEndPlugin<IAwarenessProviderFactory> =
  {
    id: PLUGIN_ID + ':awareness-factory',
    description: 'Provides awareness provider factory based on setting.',
    requires: [ISettingRegistry],
    optional: [],
    provides: IAwarenessProviderFactoryToken,
    activate: async (
      app: JupyterFrontEnd,
      settingRegistry: ISettingRegistry
    ) => {
      const { user, serverSettings } = app.serviceManager;
      const providerType = await loadProviderType(settingRegistry);
      return new SettingBasedAwarenessProviderFactory(
        providerType,
        user,
        serverSettings
      );
    }
  };

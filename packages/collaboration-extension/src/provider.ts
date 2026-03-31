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
 * Load settings from the setting registry.
 */
async function loadSettings(
  settingRegistry: ISettingRegistry
): Promise<{ providerType: 'websocket' | 'webrtc'; signalingUrls: string[] }> {
  try {
    const settings = await settingRegistry.load(PLUGIN_ID);
    const providerType = settings.get('provider').composite as
      | 'websocket'
      | 'webrtc';
    const signalingUrls =
      (settings.get('signalingUrls').composite as string[]) || [];
    return { providerType, signalingUrls };
  } catch (error) {
    console.warn('Failed to load provider settings, using defaults.', error);
    return { providerType: 'websocket', signalingUrls: [] };
  }
}

/**
 * Document provider factory that respects the setting.
 */
class SettingBasedDocumentProviderFactory implements IDocumentProviderFactory {
  constructor(
    private _providerType: 'websocket' | 'webrtc',
    private _user: User.IManager,
    private _trans: TranslationBundle,
    private _signalingUrls: string[]
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
      drive: options.drive,
      signalingUrls: this._signalingUrls
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
    private _serverSettings: ServerConnection.ISettings,
    private _signalingUrls: string[]
  ) {}

  create(options: IAwarenessProviderFactory.IOptions) {
    if (this._providerType === 'webrtc') {
      return new WebRTCAwarenessProvider({
        roomID: options.roomID,
        awareness: options.awareness,
        user: this._user,
        serverSettings: this._serverSettings,
        signalingUrls: this._signalingUrls
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
      const { providerType, signalingUrls } = await loadSettings(
        settingRegistry
      );
      return new SettingBasedDocumentProviderFactory(
        providerType,
        user,
        trans,
        signalingUrls
      );
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
      const { providerType, signalingUrls } = await loadSettings(
        settingRegistry
      );
      return new SettingBasedAwarenessProviderFactory(
        providerType,
        user,
        serverSettings,
        signalingUrls
      );
    }
  };

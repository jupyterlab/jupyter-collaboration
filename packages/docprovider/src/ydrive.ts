// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { PageConfig, URLExt } from '@jupyterlab/coreutils';
import { TranslationBundle } from '@jupyterlab/translation';
import {
  Contents,
  IContentProvider,
  RestContentProvider,
  SharedDocumentFactory,
  ServerConnection,
  User
} from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';

import { DocumentChange, ISharedDocument, YDocument } from '@jupyter/ydoc';

import { WebSocketProvider } from './yprovider';
import {
  IDocumentProvider,
  ISharedModelFactory
} from '@jupyter/collaborative-drive';
import { Awareness } from 'y-protocols/awareness';

const DISABLE_RTC =
  PageConfig.getOption('disableRTC') === 'true' ? true : false;

/**
 * The url for the default drive service.
 */
const DOCUMENT_PROVIDER_URL = 'api/collaboration/room';

export interface IForkProvider {
  connectToForkDoc: (forkRoomId: string, sessionId: string) => Promise<void>;
  reconnect: () => Promise<void>;
  contentType: string;
  format: string;
}

namespace RtcContentProvider {
  export interface IOptions extends RestContentProvider.IOptions {
    user: User.IManager;
    trans: TranslationBundle;
    globalAwareness: Awareness | null;
  }
}

export class RtcContentProvider
  extends RestContentProvider
  implements IContentProvider
{
  constructor(options: RtcContentProvider.IOptions) {
    super(options);
    this._user = options.user;
    this._trans = options.trans;
    this._globalAwareness = options.globalAwareness;
    this._serverSettings = options.serverSettings;
    this.sharedModelFactory = new SharedModelFactory(this._onCreate);
    this._providers = new Map<string, WebSocketProvider>();
  }

  /**
   * SharedModel factory for the content provider.
   */
  readonly sharedModelFactory: ISharedModelFactory;

  get providers(): Map<string, IDocumentProvider> {
    return this._providers;
  }

  /**
   * Get a file or directory.
   *
   * @param localPath: The path to the file.
   *
   * @param options: The options used to fetch the file.
   *
   * @returns A promise which resolves with the file content.
   */
  async get(
    localPath: string,
    options?: Contents.IFetchOptions
  ): Promise<Contents.IModel> {
    if (options && options.format && options.type) {
      const key = `${options.format}:${options.type}:${localPath}`;
      const provider = this._providers.get(key);

      if (provider) {
        // If the document doesn't exist, `super.get` will reject with an
        // error and the provider will never be resolved.
        // Use `Promise.all` to reject as soon as possible. The Context will
        // show a dialog to the user.
        const [model] = await Promise.all([
          super.get(localPath, { ...options, content: false }),
          provider.ready
        ]);
        // The server doesn't return a model with a format when content is false,
        // so set it back.
        return { ...model, format: options.format };
      }
    }

    return super.get(localPath, options);
  }

  /**
   * Save a file.
   *
   * @param localPath - The desired file path.
   *
   * @param options - Optional overrides to the model.
   *
   * @returns A promise which resolves with the file content model when the
   *   file is saved.
   */
  async save(
    localPath: string,
    options: Partial<Contents.IModel> = {}
  ): Promise<Contents.IModel> {
    // Check that there is a provider - it won't e.g. if the document model is not collaborative.
    if (options.format && options.type) {
      const key = `${options.format}:${options.type}:${localPath}`;
      const provider = this._providers.get(key);

      if (provider) {
        // Save is done from the backend
        const fetchOptions: Contents.IFetchOptions = {
          type: options.type,
          format: options.format,
          content: false
        };
        return this.get(localPath, fetchOptions);
      }
    }

    return super.save(localPath, options);
  }

  /**
   * A signal emitted when a file operation takes place.
   */
  get fileChanged(): ISignal<this, Contents.IChangedArgs> {
    return this._ydriveFileChanged;
  }

  private _onCreate = (
    options: Contents.ISharedFactoryOptions,
    sharedModel: YDocument<DocumentChange>
  ) => {
    if (typeof options.format !== 'string') {
      return;
    }
    try {
      const provider = new WebSocketProvider({
        url: URLExt.join(this._serverSettings.wsUrl, DOCUMENT_PROVIDER_URL),
        path: options.path,
        format: options.format,
        contentType: options.contentType,
        model: sharedModel,
        user: this._user,
        translator: this._trans
      });

      // Add the document path in the list of opened ones for this user.
      const state = this._globalAwareness?.getLocalState() || {};
      const documents: string[] = state.documents || [];
      if (!documents.includes(options.path)) {
        documents.push(options.path);
        this._globalAwareness?.setLocalStateField('documents', documents);
      }

      const key = `${options.format}:${options.contentType}:${options.path}`;
      this._providers.set(key, provider);

      sharedModel.changed.connect(async (_, change) => {
        if (!change.stateChange) {
          return;
        }
        const hashChanges = change.stateChange.filter(
          change => change.name === 'hash'
        );
        if (hashChanges.length === 0) {
          return;
        }
        if (hashChanges.length > 1) {
          console.error(
            'Unexpected multiple changes to hash value in a single transaction'
          );
        }
        const hashChange = hashChanges[0];

        // A change in hash signifies that a save occurred on the server-side
        // (e.g. a collaborator performed the save) - we want to notify the
        // observers about this change so that they can store the new hash value.
        const newPath = sharedModel.state.path ?? options.path;
        const model = await this.get(newPath as string, { content: false });

        this._ydriveFileChanged.emit({
          type: 'save',
          newValue: { ...model, hash: hashChange.newValue },
          // we do not have the old model because it was discarded when server made the change,
          // we only have the old hash here (which may be empty if the file was newly created!)
          oldValue: { hash: hashChange.oldValue }
        });
      });

      sharedModel.disposed.connect(() => {
        const provider = this._providers.get(key);
        if (provider) {
          provider.dispose();
          this._providers.delete(key);
        }

        // Remove the document path from the list of opened ones for this user.
        const state = this._globalAwareness?.getLocalState() || {};
        const documents: any[] = state.documents || [];
        const index = documents.indexOf(options.path);
        if (index > -1) {
          documents.splice(index, 1);
        }
        this._globalAwareness?.setLocalStateField('documents', documents);
      });
    } catch (error) {
      // Falling back to the contents API if opening the websocket failed
      //  This may happen if the shared document is not a YDocument.
      console.error(
        `Failed to open websocket connection for ${options.path}.\n:${error}`
      );
    }
  };

  private _user: User.IManager;
  private _trans: TranslationBundle;
  private _globalAwareness: Awareness | null;
  private _providers: Map<string, WebSocketProvider>;
  private _ydriveFileChanged = new Signal<this, Contents.IChangedArgs>(this);
  private _serverSettings: ServerConnection.ISettings;
}

/**
 * Yjs sharedModel factory for real-time collaboration.
 */
class SharedModelFactory implements ISharedModelFactory {
  documentFactories: Map<Contents.ContentType, SharedDocumentFactory>;

  /**
   * Shared model factory constructor
   *
   * @param _onCreate Callback on new document model creation
   */
  constructor(
    private _onCreate: (
      options: Contents.ISharedFactoryOptions,
      sharedModel: YDocument<DocumentChange>
    ) => void
  ) {
    this.documentFactories = new Map();
  }

  /**
   * Whether the IDrive supports real-time collaboration or not.
   */
  readonly collaborative = !DISABLE_RTC;

  /**
   * Register a SharedDocumentFactory.
   *
   * @param type Document type
   * @param factory Document factory
   */
  registerDocumentFactory(
    type: Contents.ContentType,
    factory: SharedDocumentFactory
  ) {
    if (this.documentFactories.has(type)) {
      throw new Error(`The content type ${type} already exists`);
    }
    this.documentFactories.set(type, factory);
  }

  /**
   * Create a new `ISharedDocument` instance.
   *
   * It should return `undefined` if the factory is not able to create a `ISharedDocument`.
   */
  createNew(
    options: Contents.ISharedFactoryOptions
  ): ISharedDocument | undefined {
    if (typeof options.format !== 'string') {
      console.warn(`Only defined format are supported; got ${options.format}.`);
      return;
    }

    if (!this.collaborative || !options.collaborative) {
      // Bail if the document model does not support collaboration
      // the `sharedModel` will be the default one.
      return;
    }
    if (this.documentFactories.has(options.contentType)) {
      const factory = this.documentFactories.get(options.contentType)!;
      const sharedModel = factory(options);
      this._onCreate(options, sharedModel);
      return sharedModel;
    }

    return;
  }
}

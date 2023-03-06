// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  DocumentChange,
  ISharedDocument,
  YDocument,
  YFile,
  YNotebook
} from '@jupyter/ydoc';
import { URLExt } from '@jupyterlab/coreutils';
import { TranslationBundle } from '@jupyterlab/translation';
import { Contents, Drive, User } from '@jupyterlab/services';
import { WebSocketProvider } from './yprovider';

/**
 * The url for the default drive service.
 */
const DOCUMENT_PROVIDER_URL = 'api/collaboration/room';

/**
 * A Collaborative implementation for an `IDrive`, talking to the
 * server using the Jupyter REST API and a WebSocket connection.
 */
export class YDrive extends Drive {
  /**
   * Construct a new drive object.
   *
   * @param user - The user manager to add the identity to the awareness of documents.
   */
  constructor(user: User.IManager, translator: TranslationBundle) {
    super({ name: 'YDrive' });
    this._user = user;
    this._trans = translator;
    this._providers = new Map<string, WebSocketProvider>();

    this.sharedModelFactory = new SharedModelFactory(this._onCreate);
  }

  /**
   * SharedModel factory for the YDrive.
   */
  readonly sharedModelFactory: SharedModelFactory;

  /**
   * Delete a file.
   *
   * @param localPath - The path to the file.
   *
   * @returns A promise which resolves when the file is deleted.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents).
   */
  async delete(localPath: string): Promise<void> {
    await super.delete(localPath);
    // FIXME
    // We are not removing the path from `sharedPaths` as multiple providers of the same file (with different model) may exist.
    //this._sharedPaths.delete(localPath);
  }

  /**
   * Dispose of the resources held by the manager.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this._providers.forEach(p => p.dispose());
    this._providers.clear();
    super.dispose();
  }

  /**
   * Get a file or directory.
   *
   * @param localPath: The path to the file.
   *
   * @param options: The options used to fetch the file.
   *
   * @returns A promise which resolves with the file content.
   *
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  async get(
    localPath: string,
    options?: Contents.IFetchOptions
  ): Promise<Contents.IModel> {
    if (options && options.format && options.type) {
      const key = `${options.format}:${options.type}:${localPath}`;
      const provider = this._providers.get(key);

      if (provider) {
        const model = super.get(localPath, { ...options, content: false });
        await provider.ready;
        return model;
      }
    }

    return super.get(localPath, options);
  }

  /**
   * Rename a file or directory.
   *
   * @param oldLocalPath - The original file path.
   *
   * @param newLocalPath - The new file path.
   *
   * @returns A promise which resolves with the new file contents model when
   *   the file is renamed.
   *
   * #### Notes
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  async rename(
    oldLocalPath: string,
    newLocalPath: string
  ): Promise<Contents.IModel> {
    return await super.rename(oldLocalPath, newLocalPath);
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
   *
   * #### Notes
   * Ensure that `model.content` is populated for the file.
   *
   * Uses the [Jupyter Notebook API](http://petstore.swagger.io/?url=https://raw.githubusercontent.com/jupyter/notebook/master/notebook/services/api/api.yaml#!/contents) and validates the response model.
   */
  async save(
    localPath: string,
    options: Partial<Contents.IModel> = {}
  ): Promise<Contents.IModel> {
    // Save is done from the backend
    return this.get(localPath, { ...options, content: false });
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
        url: URLExt.join(this.serverSettings.wsUrl, DOCUMENT_PROVIDER_URL),
        path: options.path,
        format: options.format,
        contentType: options.contentType,
        model: sharedModel,
        user: this._user,
        translator: this._trans
      });

      const key = `${options.format}:${options.contentType}:${options.path}`;
      this._providers.set(key, provider);

      sharedModel.disposed.connect(() => {
        const provider = this._providers.get(key);
        if (provider) {
          provider.dispose();
          this._providers.delete(key);
        }
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
  private _providers: Map<string, WebSocketProvider>;
}

/**
 * Yjs sharedModel factory for real-time collaboration.
 */
class SharedModelFactory implements Contents.ISharedFactory {
  private _disableDocumentWideUndo = true;

  constructor(
    private _onCreate: (
      options: Contents.ISharedFactoryOptions,
      sharedModel: YDocument<DocumentChange>
    ) => void
  ) {}

  /**
   * Whether the IDrive supports real-time collaboration or not.
   */
  readonly collaborative = true;

  set disableDocumentWideUndo(value: boolean) {
    this._disableDocumentWideUndo = value;
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

    if (!options.collaborative) {
      return;
    }

    let sharedModel: YDocument<DocumentChange> | undefined;
    switch (options.contentType) {
      case 'file':
        sharedModel = new YFile();
        break;
      case 'notebook':
        sharedModel = new YNotebook({
          disableDocumentWideUndoRedo: this._disableDocumentWideUndo
        });
        break;
      //default:
      // FIXME we should request a registry for the proper sharedModel
    }

    if (sharedModel) {
      this._onCreate(options, sharedModel);
    }

    return sharedModel;
  }
}

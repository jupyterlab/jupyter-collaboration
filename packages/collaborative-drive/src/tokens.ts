// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { IAwareness } from '@jupyter/ydoc';
import { Contents, SharedDocumentFactory } from '@jupyterlab/services';
import { IDisposable } from '@lumino/disposable';

import { Token } from '@lumino/coreutils';

/**
 * The collaborative drive.
 */
export const ICollaborativeContentProvider =
  new Token<ICollaborativeContentProvider>(
    '@jupyter/collaboration-extension:ICollaborativeContentProvider'
  );

/**
 * The global awareness token.
 */
export const IGlobalAwareness = new Token<IAwareness>(
  '@jupyter/collaboration:IGlobalAwareness'
);

export interface ICollaborativeContentProvider {
  /**
   * SharedModel factory for the YDrive.
   */
  readonly sharedModelFactory: ISharedModelFactory;

  readonly providers: Map<string, IDocumentProvider>;
}

/**
 * Yjs sharedModel factory for real-time collaboration.
 */
export interface ISharedModelFactory extends Contents.ISharedFactory {
  /**
   * Register a SharedDocumentFactory.
   *
   * @param type Document type
   * @param factory Document factory
   */
  registerDocumentFactory(
    type: Contents.ContentType,
    factory: SharedDocumentFactory
  ): void;

  documentFactories: Map<Contents.ContentType, SharedDocumentFactory>;
}

/**
 * An interface for a document provider.
 */
export interface IDocumentProvider extends IDisposable {
  /**
   * Returns a Promise that resolves when the document provider is ready.
   */
  readonly ready: Promise<void>;
}

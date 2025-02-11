// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { DocumentChange, IAwareness, YDocument } from '@jupyter/ydoc';
import { Contents } from '@jupyterlab/services';

import { Token } from '@lumino/coreutils';
import { WebSocketProvider } from './yprovider';

/**
 * The collaborative drive.
 */
export const ICollaborativeDrive = new Token<ICollaborativeDrive>(
  '@jupyter/collaboration-extension:ICollaborativeDrive'
);

/**
 * The global awareness token.
 */
export const IGlobalAwareness = new Token<IAwareness>(
  '@jupyter/collaboration:IGlobalAwareness'
);

/**
 * A document factory for registering shared models
 */
export type SharedDocumentFactory = (
  options: Contents.ISharedFactoryOptions
) => YDocument<DocumentChange>;

/**
 * A Collaborative implementation for an `IDrive`, talking to the
 * server using the Jupyter REST API and a WebSocket connection.
 */
export interface ICollaborativeDrive extends Contents.IDrive {
  /**
   * SharedModel factory for the YDrive.
   */
  readonly sharedModelFactory: ISharedModelFactory;

  readonly providers: Map<string, WebSocketProvider>;
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
}

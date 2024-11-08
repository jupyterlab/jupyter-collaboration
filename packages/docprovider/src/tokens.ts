/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { Token } from '@lumino/coreutils';
import { IDisposable } from '@lumino/disposable';
import { ISignal } from '@lumino/signaling';
import { IForkProvider } from './ydrive';
export interface IForkInfo {
  description?: string;
  root_roomid: string;
  synchronize: boolean;
  title?: string;
}

export interface IForkCreationResponse {
  fork_info: IForkInfo;
  fork_roomid: string;
  sessionId: string;
}

export interface IAllForksResponse {
  [forkId: string]: IForkInfo;
}

export interface IForkChangedEvent {
  fork_info: IForkInfo;
  fork_roomid: string;
  username?: string;
}

/**
 * Interface representing a Fork Manager that manages forked documents and
 * provides signals for fork-related events.
 *
 * @interface IForkManager
 * @extends IDisposable
 */
export interface IForkManager extends IDisposable {
  /**
   * Get the fork provider of a given document.
   *
   * @param options.documentPath - The document path including the
   * drive prefix.
   * @param options.format - Format of the document.
   * @param options.type - Content type of the document.
   * @returns The fork provider of the document.
   */
  getProvider(options: {
    documentPath: string;
    format: string;
    type: string;
  }): IForkProvider | undefined;

  /**
   * Creates a new fork for a given document.
   *
   * @param options.rootId - The ID of the root document to fork.
   * @param options.synchronize - A flag indicating whether the fork should be kept
   * synchronized with the root document.
   * @param options.title - An optional label for the fork.
   * @param options.description - An optional description for the fork.
   *
   * @returns A promise that resolves to an `IForkCreationResponse` if the fork
   * is created successfully, or `undefined` if the creation fails.
   */
  createFork(options: {
    rootId: string;
    synchronize: boolean;
    title?: string;
    description?: string;
  }): Promise<IForkCreationResponse | undefined>;

  /**
   * Retrieves all forks associated with a specific document.
   *
   * @param documentId - The ID of the document for which forks are to be retrieved.
   *
   * @returns A promise that resolves to an `IAllForksResponse` containing information about all forks.
   */
  getAllForks(documentId: string): Promise<IAllForksResponse>;

  /**
   * Deletes a specified fork and optionally merges its changes.
   *
   * @param options - Options for deleting the fork.
   * @param options.forkId - The ID of the fork to be deleted.
   * @param options.merge - A flag indicating whether changes from the fork should be merged back into the root document.
   *
   * @returns A promise that resolves when the fork is successfully deleted.
   */
  deleteFork(options: { forkId: string; merge: boolean }): Promise<void>;

  /**
   * Signal emitted when a new fork is added.
   *
   * @event forkAdded
   * @type ISignal<IForkManager, IForkChangedEvent>
   */
  forkAdded: ISignal<IForkManager, IForkChangedEvent>;

  /**
   * Signal emitted when a fork is deleted.
   *
   * @event forkDeleted
   * @type ISignal<IForkManager, IForkChangedEvent>
   */
  forkDeleted: ISignal<IForkManager, IForkChangedEvent>;
}

/**
 * Token providing a fork manager instance.
 */
export const IForkManagerToken = new Token<IForkManager>(
  '@jupyter/docprovider:IForkManagerToken'
);

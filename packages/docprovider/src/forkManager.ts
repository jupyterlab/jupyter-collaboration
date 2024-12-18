/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { ICollaborativeContentProvider } from '@jupyter/collaborative-drive';
import { URLExt } from '@jupyterlab/coreutils';
import { Event } from '@jupyterlab/services';
import { ISignal, Signal } from '@lumino/signaling';

import { requestAPI, ROOM_FORK_URL } from './requests';
import {
  IAllForksResponse,
  IForkChangedEvent,
  IForkCreationResponse,
  IForkManager
} from './tokens';
import { IForkProvider } from './ydrive';

export const JUPYTER_COLLABORATION_FORK_EVENTS_URI =
  'https://schema.jupyter.org/jupyter_collaboration/fork/v1';

export class ForkManager implements IForkManager {
  constructor(options: ForkManager.IOptions) {
    const { contentProvider, eventManager } = options;
    this._contentProvider = contentProvider;
    this._eventManager = eventManager;
    this._eventManager.stream.connect(this._handleEvent, this);
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
  get forkAdded(): ISignal<ForkManager, IForkChangedEvent> {
    return this._forkAddedSignal;
  }
  get forkDeleted(): ISignal<ForkManager, IForkChangedEvent> {
    return this._forkDeletedSignal;
  }

  dispose(): void {
    if (this._disposed) {
      return;
    }
    this._eventManager?.stream.disconnect(this._handleEvent);
    this._disposed = true;
  }
  async createFork(options: {
    rootId: string;
    synchronize: boolean;
    title?: string;
    description?: string;
  }): Promise<IForkCreationResponse | undefined> {
    const { rootId, title, description, synchronize } = options;
    const init: RequestInit = {
      method: 'PUT',
      body: JSON.stringify({ title, description, synchronize })
    };
    const url = URLExt.join(ROOM_FORK_URL, rootId);
    const response = await requestAPI<IForkCreationResponse>(url, init);
    return response;
  }

  async getAllForks(rootId: string) {
    const url = URLExt.join(ROOM_FORK_URL, rootId);
    const init = { method: 'GET' };
    const response = await requestAPI<IAllForksResponse>(url, init);
    return response;
  }

  async deleteFork(options: { forkId: string; merge: boolean }): Promise<void> {
    const { forkId, merge } = options;
    const url = URLExt.join(ROOM_FORK_URL, forkId);
    const query = URLExt.objectToQueryString({ merge });
    const init = { method: 'DELETE' };
    await requestAPI(`${url}${query}`, init);
  }
  getProvider(options: {
    documentPath: string;
    format: string;
    type: string;
  }): IForkProvider | undefined {
    const { documentPath, format, type } = options;
    const contentProvider = this._contentProvider;
    if (contentProvider) {
      const docPath = documentPath;
      const provider = contentProvider.providers.get(
        `${format}:${type}:${docPath}`
      );
      return provider as IForkProvider | undefined;
    }
    return;
  }

  private _handleEvent(_: Event.IManager, emission: Event.Emission) {
    if (emission.schema_id === JUPYTER_COLLABORATION_FORK_EVENTS_URI) {
      switch (emission.action) {
        case 'create': {
          this._forkAddedSignal.emit(emission as any);
          break;
        }
        case 'delete': {
          this._forkDeletedSignal.emit(emission as any);
          break;
        }
        default:
          break;
      }
    }
  }

  private _disposed = false;
  private _contentProvider: ICollaborativeContentProvider | undefined;
  private _eventManager: Event.IManager | undefined;
  private _forkAddedSignal = new Signal<ForkManager, IForkChangedEvent>(this);
  private _forkDeletedSignal = new Signal<ForkManager, IForkChangedEvent>(this);
}

export namespace ForkManager {
  export interface IOptions {
    contentProvider: ICollaborativeContentProvider;
    eventManager: Event.IManager;
  }
}

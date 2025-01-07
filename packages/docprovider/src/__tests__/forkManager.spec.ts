// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { ICollaborativeContentProvider } from '@jupyter/collaborative-drive';
import {
  ForkManager,
  JUPYTER_COLLABORATION_FORK_EVENTS_URI
} from '../forkManager';
import { Event } from '@jupyterlab/services';
import { Signal } from '@lumino/signaling';
import { requestAPI } from '../requests';
jest.mock('../requests');

const contentProviderMock = {
  providers: new Map()
} as ICollaborativeContentProvider;
const stream = new Signal({});
const eventManagerMock = {
  stream: stream as any
} as Event.IManager;

describe('@jupyter/docprovider', () => {
  let manager: ForkManager;
  beforeEach(() => {
    manager = new ForkManager({
      contentProvider: contentProviderMock,
      eventManager: eventManagerMock
    });
  });
  describe('forkManager', () => {
    it('should have a type', () => {
      expect(ForkManager).not.toBeUndefined();
    });
    it('should be able to create instance', () => {
      expect(manager).toBeInstanceOf(ForkManager);
    });
    it('should be able to create new fork', async () => {
      await manager.createFork({
        rootId: 'root-uuid',
        synchronize: true,
        title: 'my fork label',
        description: 'my fork description'
      });
      expect(requestAPI).toHaveBeenCalledWith(
        'api/collaboration/fork/root-uuid',
        {
          method: 'PUT',
          body: JSON.stringify({
            title: 'my fork label',
            description: 'my fork description',
            synchronize: true
          })
        }
      );
    });
    it('should be able to get all forks', async () => {
      await manager.getAllForks('root-uuid');
      expect(requestAPI).toHaveBeenCalledWith(
        'api/collaboration/fork/root-uuid',
        {
          method: 'GET'
        }
      );
    });
    it('should be able to get delete forks', async () => {
      await manager.deleteFork({ forkId: 'fork-uuid', merge: true });
      expect(requestAPI).toHaveBeenCalledWith(
        'api/collaboration/fork/fork-uuid?merge=true',
        {
          method: 'DELETE'
        }
      );
    });
    it('should be able to emit fork added signal', async () => {
      const listener = jest.fn();
      manager.forkAdded.connect(listener);
      const data = {
        schema_id: JUPYTER_COLLABORATION_FORK_EVENTS_URI,
        action: 'create'
      };
      stream.emit(data);
      expect(listener).toHaveBeenCalledWith(manager, data);
    });
    it('should be able to emit fork deleted signal', async () => {
      const listener = jest.fn();
      manager.forkDeleted.connect(listener);
      const data = {
        schema_id: JUPYTER_COLLABORATION_FORK_EVENTS_URI,
        action: 'delete'
      };
      stream.emit(data);
      expect(listener).toHaveBeenCalledWith(manager, data);
    });
  });
});

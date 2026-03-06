// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/// <reference types="jest" />

import { YFile } from '@jupyter/ydoc';
import { nullTranslator } from '@jupyterlab/translation';
import { FakeUserManager } from '@jupyterlab/testutils';
import { requestDocSession } from '../requests';
import { WebSocketProvider } from '../yprovider';

jest.mock('../requests', () => ({
  requestDocSession: jest.fn()
}));

interface IMockWsProvider {
  emit: (eventName: string, payload: any) => void;
}

jest.mock('y-websocket', () => ({
  WebsocketProvider: class {
    roomname: string;
    private _listeners = new Map<string, Set<(payload: any) => void>>();

    constructor(_url: string, roomname: string) {
      this.roomname = roomname;
    }

    on(eventName: string, listener: (payload: any) => void): void {
      if (!this._listeners.has(eventName)) {
        this._listeners.set(eventName, new Set());
      }
      this._listeners.get(eventName)!.add(listener);
    }

    off(eventName: string, listener: (payload: any) => void): void {
      this._listeners.get(eventName)?.delete(listener);
    }

    destroy(): void {
      this._listeners.clear();
    }

    emit(eventName: string, payload: any): void {
      const listeners = this._listeners.get(eventName);
      if (!listeners) {
        return;
      }
      listeners.forEach(listener => listener(payload));
    }
  }
}));

async function waitForProviderConnect(
  provider: WebSocketProvider
): Promise<IMockWsProvider> {
  for (let i = 0; i < 10; i++) {
    const wsProvider = provider.wsProvider as unknown as IMockWsProvider;
    if (wsProvider) {
      return wsProvider;
    }
    await Promise.resolve();
  }
  throw new Error('WebSocket provider was not initialized');
}

function createProvider(
  options: { path?: string; model?: YFile } = {}
): WebSocketProvider {
  const { path = 'test.ipynb', model = new YFile() } = options;
  const translator = nullTranslator.load('test');
  const identity = {
    username: 'Joe Doe',
    display_name: 'Joe Doe',
    name: 'Joe Doe',
    initials: 'JD',
    color: 'red'
  };
  const user = new FakeUserManager({}, identity, {});

  return new WebSocketProvider({
    path,
    contentType: 'file',
    format: 'text',
    model,
    user,
    translator
  });
}

describe('@jupyter/docprovider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (requestDocSession as jest.Mock).mockResolvedValue({
      sessionId: 'session-id',
      format: 'text',
      type: 'file',
      fileId: 'file-id'
    });
  });

  describe('WebSocketProvider', () => {
    it('should have a type', () => {
      expect(WebSocketProvider).not.toBeUndefined();
    });

    describe('#ready', () => {
      it('should reject ready if websocket closes with 4400 before sync', async () => {
        const model = new YFile();
        const disposeSpy = jest.spyOn(model, 'dispose');
        const provider = createProvider({ path: 'decode-error.py', model });
        const wsProvider = await waitForProviderConnect(provider);

        wsProvider.emit('connection-close', { code: 4400 });

        await expect(provider.ready).rejects.toBe(
          'Bad request for decode-error.py'
        );
        expect(disposeSpy).toHaveBeenCalled();
      });

      it('should not dispose shared model if websocket closes after sync', async () => {
        const model = new YFile();
        const disposeSpy = jest.spyOn(model, 'dispose');
        const provider = createProvider({ path: 'synced.py', model });

        const wsProvider = await waitForProviderConnect(provider);

        wsProvider.emit('sync', true);
        await expect(provider.ready).resolves.toBeUndefined();

        wsProvider.emit('connection-close', { code: 4400 });

        expect(disposeSpy).not.toHaveBeenCalled();
      });

      it('should reject ready if websocket closes with 4500 before sync', async () => {
        const provider = createProvider({ path: 'test.py' });
        const wsProvider = await waitForProviderConnect(provider);

        wsProvider.emit('connection-close', { code: 4500 });

        await expect(provider.ready).rejects.toBe(
          'Internal server error when loading test.py'
        );
      });

      it('should resolve ready when sync happens', async () => {
        const provider = createProvider();
        const wsProvider = await waitForProviderConnect(provider);

        wsProvider.emit('sync', true);

        await expect(provider.ready).resolves.toBeUndefined();
      });
    });
  });
});

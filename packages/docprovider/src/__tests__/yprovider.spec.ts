// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/// <reference types="jest" />

import { YFile } from '@jupyter/ydoc';
import { nullTranslator } from '@jupyterlab/translation';
import {
  acceptDialog,
  dismissDialog,
  FakeUserManager,
  sleep,
  waitForDialog
} from '@jupyterlab/testutils';
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

async function waitForMockCallCount(
  mockFn: jest.Mock,
  expectedCalls: number,
  timeout = 1000
): Promise<void> {
  const interval = 25;
  const limit = Math.floor(timeout / interval);
  for (let i = 0; i < limit; i++) {
    if (mockFn.mock.calls.length >= expectedCalls) {
      return;
    }
    await sleep(interval);
  }
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

describe('session close handling', () => {
  let provider: WebSocketProvider;

  beforeEach(async () => {
    jest.clearAllMocks();
    (requestDocSession as jest.Mock).mockResolvedValue({
      sessionId: 'session-id',
      format: 'text',
      type: 'file',
      fileId: 'file-id'
    });
    delete (window as any).location;
    (window as any).location = { reload: jest.fn() };
    provider = createProvider();
  });

  afterEach(async () => {
    provider.dispose();
    await dismissDialog(undefined, 50);
  });

  it('should not show dialog for non-1003 close codes', async () => {
    const wsProvider = await waitForProviderConnect(provider);
    wsProvider.emit('connection-close', {
      code: 1000,
      reason: 'normal'
    } as CloseEvent);
    await expect(waitForDialog(undefined, 1000)).rejects.toThrow(
      'Dialog not found'
    );
  });

  it('should show dialog on 1003 close', async () => {
    const wsProvider = await waitForProviderConnect(provider);
    wsProvider.emit('connection-close', {
      code: 1003,
      reason: JSON.stringify({
        reason: 'unknown_session',
        sessionId: 'old-id',
        reloadable: false
      })
    } as CloseEvent);
    await expect(waitForDialog(undefined, 1000)).resolves.toBeUndefined();
    await acceptDialog(undefined, 1000);
  });

  it('should reload when user accepts the dialog', async () => {
    const wsProvider = await waitForProviderConnect(provider);
    wsProvider.emit('connection-close', {
      code: 1003,
      reason: JSON.stringify({
        reason: 'unknown_session',
        sessionId: 'dp-id',
        reloadable: true
      })
    } as CloseEvent);
    await waitForDialog(undefined, 1000);
    await acceptDialog(undefined, 1000);
    await waitForMockCallCount(window.location.reload as jest.Mock, 1);
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('should not reload when reloadable is false', async () => {
    const wsProvider = await waitForProviderConnect(provider);
    wsProvider.emit('connection-close', {
      code: 1003,
      reason: JSON.stringify({ reason: 'version_mismatch', reloadable: false })
    } as CloseEvent);
    await waitForDialog(undefined, 1000);
    await acceptDialog(undefined, 1000);
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

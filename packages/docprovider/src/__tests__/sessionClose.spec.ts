// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/// <reference types="jest" />

import { YFile } from '@jupyter/ydoc';
import { nullTranslator } from '@jupyterlab/translation';
import { requestDocSession } from '../requests';
import { WebSocketProvider } from '../yprovider';

jest.mock('../requests', () => ({
  requestDocSession: jest.fn()
}));

jest.mock('@jupyterlab/apputils', () => ({
  showDialog: jest.fn(),
  Dialog: {
    cancelButton: jest.fn((opts?: any) => ({ label: opts?.label ?? 'Cancel', accept: false })),
    okButton: jest.fn((opts?: any) => ({ label: opts?.label ?? 'Ok', accept: true }))
  }
}));

jest.mock('y-websocket', () => ({
  WebsocketProvider: class {
    private _listeners = new Map<string, Set<(payload: any) => void>>();

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
      this._listeners.get(eventName)?.forEach(l => l(payload));
    }
  }
}));

const { showDialog } = jest.requireMock('@jupyterlab/apputils');
const mockShowDialog = showDialog as jest.MockedFunction<typeof showDialog>;

const mockUser = {
  identity: { username: 'Joe', display_name: 'Joe', name: 'Joe', initials: 'J', color: 'red' },
  isReady: true,
  ready: Promise.resolve(),
  changed: { connect: jest.fn(), disconnect: jest.fn() },
  userChanged: { connect: jest.fn(), disconnect: jest.fn() }
} as any;

function createProvider(): WebSocketProvider {
  return new WebSocketProvider({
    path: 'test.ipynb',
    contentType: 'file',
    format: 'text',
    model: new YFile(),
    user: mockUser,
    translator: nullTranslator.load('test')
  });
}

async function waitForProvider(provider: WebSocketProvider) {
  for (let i = 0; i < 10; i++) {
    const ws = (provider as any).wsProvider;
    if (ws) return ws;
    await Promise.resolve();
  }
  throw new Error('wsProvider not initialized');
}

describe('session close handling', () => {
  let provider: WebSocketProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    (requestDocSession as jest.Mock).mockResolvedValue({
      sessionId: 'session-id',
      format: 'text',
      type: 'file',
      fileId: 'file-id'
    });
    mockShowDialog.mockResolvedValue({ button: { accept: false } } as any);
    delete (window as any).location;
    (window as any).location = { reload: jest.fn() };
    provider = createProvider();
  });

  afterEach(() => {
    provider.dispose();
  });

  it('should not show dialog for non-1003 close codes', async () => {
    const ws = await waitForProvider(provider);
    ws.emit('connection-close', { code: 1000, reason: 'normal' });
    await Promise.resolve();
    expect(mockShowDialog).not.toHaveBeenCalled();
  });

  it('should show dialog on 1003 close', async () => {
    const ws = await waitForProvider(provider);
    ws.emit('connection-close', {
      code: 1003,
      reason: JSON.stringify({ reason: 'unknown_session', sessionId: 'old-id', reloadable: true })
    });
    await Promise.resolve();
    expect(mockShowDialog).toHaveBeenCalledTimes(1);
  });

  it('should reload when user accepts the dialog', async () => {
    mockShowDialog.mockResolvedValue({ button: { accept: true } } as any);
    const ws = await waitForProvider(provider);
    ws.emit('connection-close', {
      code: 1003,
      reason: JSON.stringify({ reason: 'unknown_session', sessionId: 'old-id', reloadable: true })
    });
    await Promise.resolve();
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('should not reload when reloadable is false', async () => {
    mockShowDialog.mockResolvedValue({ button: { accept: true } } as any);
    const ws = await waitForProvider(provider);
    ws.emit('connection-close', {
      code: 1003,
      reason: JSON.stringify({ reason: 'initialization_error', path: 'test.txt', reloadable: false })
    });
    await Promise.resolve();
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

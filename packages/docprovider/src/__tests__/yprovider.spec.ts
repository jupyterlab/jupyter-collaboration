import { Widget } from '@lumino/widgets';
// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/// <reference types="jest" />

import * as encoding from 'lib0/encoding';
import { ContentsManager, ServerConnection } from '@jupyterlab/services';
import { YFile } from '@jupyter/ydoc';
import { nullTranslator } from '@jupyterlab/translation';
import {
  acceptDialog,
  dangerDialog,
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
      const listeners = this._listeners.get(eventName);
      if (listeners) {
        listeners.add(listener);
      }
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
  options: {
    path?: string;
    model?: YFile;
    onSwitchDocument?: (path: string) => Promise<void>;
    onCloseDocument?: () => void;
  } = {}
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
    translator,
    showNotice: notice => Widget.attach(notice, document.body),
    onSwitchDocument: options.onSwitchDocument,
    onCloseDocument: options.onCloseDocument
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
    describe('external changes', () => {
      function clickButton(label: string): void {
        Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
          .find(button => button.textContent === label)!
          .click();
      }

      async function setup(syncBeforeStatus = true) {
        jest
          .spyOn(ContentsManager.prototype, 'get')
          .mockImplementation(async (_path, options) => {
            if (options?.content === false) {
              throw new ServerConnection.ResponseError(
                new Response(null, { status: 404 })
              );
            }
            return {
              content: options?.content
                ? [{ name: 'original.txt' }, { name: 'original-Copy1.txt' }]
                : null
            } as any;
          });
        const save = jest
          .spyOn(ContentsManager.prototype, 'save')
          .mockResolvedValue({} as any);
        const model = new YFile();
        model.setSource('shared content');
        const onSwitchDocument = jest.fn().mockResolvedValue(undefined);
        const onCloseDocument = jest.fn();
        const provider = createProvider({
          model,
          onSwitchDocument,
          onCloseDocument
        });
        const action = jest
          .spyOn(provider as any, '_requestDocumentAction')
          .mockResolvedValue(undefined);
        const websocket = await waitForProviderConnect(provider);
        if (syncBeforeStatus) {
          websocket.emit('sync', true);
        }
        const sendStatus = async (change: { originalPath: string } | null) => {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, 2);
          encoding.writeVarString(
            encoder,
            JSON.stringify({ type: 'external-change', change })
          );
          await (provider as any)._handleConflictMessage(
            new MessageEvent('message', {
              data: encoding.toUint8Array(encoder).buffer
            })
          );
        };
        await sendStatus({ originalPath: 'original.txt' });
        if (!syncBeforeStatus) {
          expect(
            document.querySelector('.jp-CollaborationExternalChangeNotice')
          ).toBeNull();
          websocket.emit('sync', true);
        }
        await sleep(20);
        return {
          model,
          provider,
          save,
          action,
          onSwitchDocument,
          onCloseDocument,
          sendStatus
        };
      }

      it('waits for a choice without automatically saving a copy', async () => {
        const { model, provider, action } = await setup();
        expect(
          document.querySelector('.jp-CollaborationExternalChangeNotice')
            ?.textContent
        ).toContain('changed on disk');
        expect(action).not.toHaveBeenCalled();
        expect(
          document.querySelector('.jp-CollaborationExternalChangeNotice')
            ?.textContent
        ).not.toContain('Not now');
        document
          .querySelector('.jp-CollaborationExternalChangeNotice')!
          .dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              keyCode: 27,
              bubbles: true
            })
          );
        await sleep(50);
        expect(
          document.querySelector('.jp-CollaborationExternalChangeNotice')
        ).not.toBeNull();
        expect(model.getSource()).toBe('shared content');
        expect(action).not.toHaveBeenCalled();
        clickButton('Close tab');
        await sleep(50);
        provider.dispose();
      });

      it('handles repeated status and clears the dialog when the server resolves it', async () => {
        const { model, provider, action, sendStatus } = await setup();
        expect(model.ydoc.getMap('state').has('outofband')).toBe(false);
        await sendStatus({ originalPath: 'original.txt' });
        await sleep(50);
        expect(
          document.querySelectorAll('.jp-CollaborationExternalChangeNotice')
        ).toHaveLength(1);
        await sendStatus(null);
        await sleep(50);
        expect(
          document.querySelector('.jp-CollaborationExternalChangeNotice')
        ).toBeNull();
        await provider.save();
        expect(action).toHaveBeenCalledWith('save');
        await sendStatus({ originalPath: 'original.txt' });
        await sleep(20);
        clickButton('Close tab');
        await sleep(50);
        provider.dispose();
      });

      it('waits for document sync when the initial RAW status arrives first', async () => {
        const { provider, action } = await setup(false);
        clickButton('Close tab');
        await sleep(50);
        expect(action).not.toHaveBeenCalled();
        provider.dispose();
      });

      it('switches only this client when opening the original', async () => {
        const { model, provider, action, onSwitchDocument } = await setup();
        clickButton('Load from disk');
        await sleep(50);
        expect(action).not.toHaveBeenCalled();
        expect(onSwitchDocument).toHaveBeenCalledWith('original.txt');
        expect(model.getSource()).toBe('shared content');
        provider.dispose();
      });

      it('saves only after a new name has been accepted', async () => {
        const { model, provider, action, save, onSwitchDocument } =
          await setup();
        clickButton('Save As…');
        await sleep(50);
        await waitForDialog();
        const input =
          document.querySelector<HTMLInputElement>('.jp-Dialog input')!;
        expect(input.value).toBe('original-Copy2.txt');
        input.value = 'chosen.txt';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        expect(action).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        model.setSource('latest edits');
        await acceptDialog();
        await sleep(50);
        expect(action).not.toHaveBeenCalled();
        expect(save).toHaveBeenCalledWith('chosen.txt', {
          type: 'file',
          format: 'text',
          content: 'latest edits'
        });
        expect(onSwitchDocument).toHaveBeenCalledWith('chosen.txt');
        provider.dispose();
      });

      it('rejects original and existing destinations without writing', async () => {
        const { provider, save } = await setup();
        await expect(
          (provider as any)._saveAs('original.txt', 'original.txt')
        ).rejects.toThrow('Choose a new filename');
        jest
          .spyOn(ContentsManager.prototype, 'get')
          .mockResolvedValue({} as any);
        await expect(
          (provider as any)._saveAs('existing.txt', 'original.txt')
        ).rejects.toThrow('already exists');
        expect(save).not.toHaveBeenCalled();
        provider.dispose();
      });

      it('keeps the current document when a Contents API save fails and allows retry', async () => {
        const { provider, model, save, onSwitchDocument } = await setup();
        save.mockRejectedValueOnce(new Error('disk full'));
        await expect(
          (provider as any)._saveAs('chosen.txt', 'original.txt')
        ).rejects.toThrow('disk full');
        expect(onSwitchDocument).not.toHaveBeenCalled();
        expect(model.getSource()).toBe('shared content');
        await expect(
          (provider as any)._saveAs('chosen.txt', 'original.txt')
        ).resolves.toBeUndefined();
        provider.dispose();
      });

      it('closes locally without replacing shared content', async () => {
        const { model, provider, action, onCloseDocument, onSwitchDocument } =
          await setup();
        clickButton('Close tab');
        await sleep(50);
        expect(action).not.toHaveBeenCalled();
        expect(onCloseDocument).toHaveBeenCalledTimes(1);
        expect(onSwitchDocument).not.toHaveBeenCalled();
        expect(model.getSource()).toBe('shared content');
        provider.dispose();
      });

      it('returns to the choices when Save As is canceled', async () => {
        const { provider, action } = await setup();
        clickButton('Save As…');
        await sleep(50);
        await waitForDialog();
        await dismissDialog();
        await sleep(50);
        await sleep(20);
        expect(
          document.querySelector('.jp-CollaborationExternalChangeNotice')
            ?.textContent
        ).toContain('changed on disk');
        expect(action).not.toHaveBeenCalled();
        clickButton('Close tab');
        await sleep(50);
        provider.dispose();
      });
    });

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

      it('should show loading dialog when load timeout fires before sync', async () => {
        const provider = createProvider();
        await waitForProviderConnect(provider);

        // Fire timeout without awaiting (showDialog blocks)
        (provider as any)._onLoadTimeout();

        await expect(waitForDialog(undefined, 1000)).resolves.toBeUndefined();
        await dismissDialog(undefined, 50);
        await sleep(100);
        provider.dispose();
      });

      it('should not show loading dialog if sync happened before timeout', async () => {
        const provider = createProvider();
        const wsProvider = await waitForProviderConnect(provider);

        wsProvider.emit('sync', true);
        await expect(provider.ready).resolves.toBeUndefined();

        // Fire timeout without awaiting
        (provider as any)._onLoadTimeout();

        // Dialog should not have appeared since document was already synced
        await expect(waitForDialog(undefined, 1000)).rejects.toThrow(
          'Dialog not found'
        );
        provider.dispose();
      });

      it('should reject ready and dispose model when cancel is clicked', async () => {
        const model = new YFile();
        const disposeSpy = jest.spyOn(model, 'dispose');
        const provider = createProvider({ model });
        await waitForProviderConnect(provider);

        // Fire timeout without awaiting
        (provider as any)._onLoadTimeout();

        await waitForDialog(undefined, 1000);
        // Cancel button is the first button (accept=false)
        await dismissDialog(undefined, 50);
        await sleep(100);

        await expect(provider.ready).rejects.toBe(
          'The document failed to load. Please try opening it again.'
        );
        expect(disposeSpy).toHaveBeenCalled();
        provider.dispose();
      });

      it('should retry loading when retry is clicked', async () => {
        const reconnectSpy = jest.spyOn(
          WebSocketProvider.prototype,
          'reconnect'
        );
        const provider = createProvider();
        await waitForProviderConnect(provider);

        // Fire timeout without awaiting
        (provider as any)._onLoadTimeout();

        await waitForDialog(undefined, 1000);
        await dangerDialog(undefined, 50);
        await sleep(100);

        expect(reconnectSpy).toHaveBeenCalled();
        reconnectSpy.mockRestore();
        provider.dispose();
      });

      it('should restart timeout when continue waiting is clicked', async () => {
        const startLoadTimeoutSpy = jest.spyOn(
          WebSocketProvider.prototype as any,
          '_startLoadTimeout'
        );
        const provider = createProvider();
        await waitForProviderConnect(provider);

        (provider as any)._onLoadTimeout();

        await waitForDialog(undefined, 1000);
        await acceptDialog(undefined, 50);
        await sleep(100);

        expect(startLoadTimeoutSpy).toHaveBeenCalled();
        startLoadTimeoutSpy.mockRestore();
        provider.dispose();
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
    await sleep(50);
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
    await sleep(50);
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

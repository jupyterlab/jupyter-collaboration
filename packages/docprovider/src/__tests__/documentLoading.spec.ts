/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { Dialog } from '@jupyterlab/apputils';
import { nullTranslator } from '@jupyterlab/translation';
import { PromiseDelegate } from '@lumino/coreutils';
import { DocumentLoadingHandler } from '../documentLoading';

jest.mock('@jupyterlab/apputils', () => {
  const actual = jest.requireActual('@jupyterlab/apputils');
  class LoadingDialog {
    static instances: LoadingDialog[] = [];
    private _resolveResult!: (result: any) => void;
    private _result = new Promise(resolve => {
      this._resolveResult = resolve;
    });
    constructor(readonly options: any) {
      LoadingDialog.instances.push(this);
    }
    launch = () => this._result;
    resolve = jest.fn((index = 0) =>
      this._resolveResult({ button: this.options.buttons[index] })
    );
    static cancelButton = (options: any) => ({ ...options, actions: [] });
    static okButton = (options: any) => options;
    static warnButton = (options: any) => options;
  }
  return { ...actual, Dialog: LoadingDialog };
});

interface ITestDialog {
  options: { buttons: { label: string; actions: string[] }[] };
  resolve: jest.Mock;
}
const dialogs = (Dialog as unknown as { instances: ITestDialog[] }).instances;
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('DocumentLoadingHandler', () => {
  let ready: PromiseDelegate<void>;
  let handler: DocumentLoadingHandler;
  let onRetry: jest.Mock;
  let onCancel: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    dialogs.length = 0;
    ready = new PromiseDelegate<void>();
    onRetry = jest.fn().mockResolvedValue(undefined);
    onCancel = jest.fn();
    handler = new DocumentLoadingHandler({
      ready: ready.promise,
      translator: nullTranslator.load('test'),
      onRetry,
      onCancel
    });
  });
  afterEach(() => {
    handler.dispose();
    jest.useRealTimers();
  });

  it('shows the common loading choices after five seconds', () => {
    jest.advanceTimersByTime(4999);
    expect(dialogs).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].options.buttons.map(button => button.label)).toEqual([
      'Cancel',
      'Continue waiting',
      'Retry'
    ]);
    handler.start();
    handler.start();
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(2);
  });

  it('does not prompt if readiness resolves before the deadline', async () => {
    ready.resolve();
    await flush();
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(0);
    expect(handler.isDisposed).toBe(true);
  });

  it('closes the prompt on synchronization without running a user action', async () => {
    jest.advanceTimersByTime(5000);
    ready.resolve();
    await flush();
    expect(dialogs[0].resolve).toHaveBeenCalledWith(0);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('closes the prompt when readiness rejects', async () => {
    jest.advanceTimersByTime(5000);
    ready.reject(new Error('connection failed'));
    await flush();
    expect(handler.isDisposed).toBe(true);
    expect(dialogs[0].resolve).toHaveBeenCalledWith(0);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('delegates cancel to the provider and does not prompt again', async () => {
    jest.advanceTimersByTime(5000);
    dialogs[0].resolve(0);
    await flush();
    expect(onCancel).toHaveBeenCalledWith(
      'The document failed to load. Please try opening it again.'
    );
    expect(handler.isDisposed).toBe(true);
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(1);
  });

  it('continues waiting without reconnecting', async () => {
    jest.advanceTimersByTime(5000);
    dialogs[0].resolve(1);
    await flush();
    jest.advanceTimersByTime(4999);
    expect(dialogs).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(dialogs).toHaveLength(2);
    expect(onRetry).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('delegates retry and starts another waiting period', async () => {
    jest.advanceTimersByTime(5000);
    dialogs[0].resolve(2);
    await flush();
    expect(onRetry).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(2);
  });

  it('ignores a dialog result from an attempt that was stopped', async () => {
    jest.advanceTimersByTime(5000);
    dialogs[0].resolve(2);
    handler.stop();
    await flush();
    expect(onRetry).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    handler.start();
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(2);
  });

  it('does not restart the timer after synchronization during a retry', async () => {
    const retry = new PromiseDelegate<void>();
    onRetry.mockReturnValue(retry.promise);
    jest.advanceTimersByTime(5000);
    dialogs[0].resolve(2);
    await flush();
    ready.resolve();
    retry.resolve();
    await flush();
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(1);
  });

  it('does not dismiss a newer dialog when a retry callback finishes late', async () => {
    const retry = new PromiseDelegate<void>();
    onRetry.mockReturnValue(retry.promise);
    jest.advanceTimersByTime(5000);
    dialogs[0].resolve(2);
    await flush();
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(2);
    retry.resolve();
    await flush();
    expect(dialogs[1].resolve).not.toHaveBeenCalled();
  });

  it('cleans up an active dialog when disposed', async () => {
    jest.advanceTimersByTime(5000);
    handler.dispose();
    await flush();
    expect(dialogs[0].resolve).toHaveBeenCalledWith(0);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
    handler.start();
    jest.advanceTimersByTime(5000);
    expect(dialogs).toHaveLength(1);
  });
});

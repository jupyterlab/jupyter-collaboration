/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { PromiseDelegate } from '@lumino/coreutils';
import { nullTranslator } from '@jupyterlab/translation';
import { acceptDialog, sleep, waitForDialog } from '@jupyterlab/testutils';
import { ExternalChangeHandler } from '../externalChange';

function click(label: string): void {
  Array.from(document.querySelectorAll<HTMLButtonElement>('.jp-Dialog button'))
    .find(button => button.textContent === label)!
    .click();
}

function setup(ready = Promise.resolve()) {
  const actions = {
    openOriginal: jest.fn().mockResolvedValue(undefined),
    saveAs: jest.fn().mockResolvedValue(undefined)
  };
  const onSwitchDocument = jest.fn().mockResolvedValue(undefined);
  const onCloseDocument = jest.fn();
  const get = jest.fn().mockResolvedValue({
    content: [{ name: 'Untitled.ipynb' }, { name: 'Untitled-Copy1.ipynb' }]
  });
  const handler = new ExternalChangeHandler({
    ready,
    translator: nullTranslator.load('jupyter-collaboration'),
    contents: { get },
    actions,
    onSwitchDocument,
    onCloseDocument
  });
  return { handler, actions, onSwitchDocument, onCloseDocument, get };
}

describe('ExternalChangeHandler without a document transport', () => {
  it('waits for readiness and opens the original through the supplied actions', async () => {
    const ready = new PromiseDelegate<void>();
    const { handler, actions, onSwitchDocument } = setup(ready.promise);
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    expect(
      document.querySelector('.jp-CollaborationExternalChangeDialog')
    ).toBeNull();
    ready.resolve();
    await waitForDialog();
    click('Open original file');
    await sleep(50);
    expect(actions.openOriginal).toHaveBeenCalledWith('Untitled.ipynb');
    expect(onSwitchDocument).toHaveBeenCalledWith('Untitled.ipynb');
    handler.dispose();
  });

  it('saves the selected copy using injected contents and server operations', async () => {
    const { handler, actions, onSwitchDocument, get } = setup();
    handler.updateStatus({ originalPath: 'folder/Untitled.ipynb' });
    await waitForDialog();
    click('Save As…');
    await sleep(50);
    await waitForDialog();
    expect(get).toHaveBeenCalledWith('folder', {
      type: 'directory',
      content: true
    });
    expect(
      document.querySelector<HTMLInputElement>('.jp-Dialog input')!.value
    ).toBe('folder/Untitled-Copy2.ipynb');
    expect(actions.saveAs).not.toHaveBeenCalled();
    await acceptDialog();
    await sleep(50);
    expect(actions.saveAs).toHaveBeenCalledWith(
      'folder/Untitled-Copy2.ipynb',
      'folder/Untitled.ipynb'
    );
    expect(onSwitchDocument).toHaveBeenCalledWith(
      'folder/Untitled-Copy2.ipynb'
    );
    handler.dispose();
  });

  it('blocks saving while status is unresolved and closes the dialog on disposal', async () => {
    const { handler, actions } = setup();
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await waitForDialog();
    await expect(handler.ensureCanSave()).rejects.toHaveProperty(
      'name',
      'ModalCancelError'
    );
    handler.updateStatus(null);
    await sleep(50);
    await expect(handler.ensureCanSave()).resolves.toBeUndefined();
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await waitForDialog();
    handler.dispose();
    await sleep(50);
    expect(
      document.querySelector('.jp-CollaborationExternalChangeDialog')
    ).toBeNull();
    expect(actions.openOriginal).not.toHaveBeenCalled();
    expect(actions.saveAs).not.toHaveBeenCalled();
  });
});

/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { Widget } from '@lumino/widgets';
import { PromiseDelegate } from '@lumino/coreutils';
import { nullTranslator } from '@jupyterlab/translation';
import { acceptDialog, sleep, waitForDialog } from '@jupyterlab/testutils';
import { ExternalChangeHandler } from '../externalChange';

function click(label: string): void {
  const container = document.querySelector('.jp-Dialog') ?? document;
  Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find(button => button.textContent === label)!
    .click();
}

function setup(
  ready = Promise.resolve(),
  preferences: Pick<
    ExternalChangeHandler.IOptions,
    'autoReload' | 'onShowDiff'
  > = {}
) {
  const actions = {
    overwrite: jest.fn().mockResolvedValue(undefined),
    saveAs: jest.fn().mockResolvedValue(undefined)
  };
  const onSwitchDocument = jest.fn().mockResolvedValue(undefined);
  const onCloseDocument = jest.fn();
  const get = jest.fn().mockResolvedValue({
    content: [{ name: 'Untitled.ipynb' }, { name: 'Untitled-Copy1.ipynb' }]
  });
  let beforeSave!: () => Promise<void>;
  const handler = new ExternalChangeHandler({
    ready,
    ...preferences,
    translator: nullTranslator.load('jupyter-collaboration'),
    contents: { get },
    actions,
    onSwitchDocument,
    onCloseDocument,
    showNotice: (notice, guard) => {
      beforeSave = guard;
      Widget.attach(notice, document.body);
    }
  });
  return {
    handler,
    actions,
    onSwitchDocument,
    onCloseDocument,
    get,
    beforeSave: () => beforeSave()
  };
}

describe('ExternalChangeHandler without a document transport', () => {
  it('waits for readiness and switches to the original locally', async () => {
    const ready = new PromiseDelegate<void>();
    const { handler, onSwitchDocument } = setup(ready.promise);
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    expect(
      document.querySelector('.jp-CollaborationExternalChangeNotice')
    ).toBeNull();
    ready.resolve();
    await sleep(20);
    click('Load from disk');
    await sleep(50);
    expect(onSwitchDocument).toHaveBeenCalledWith('Untitled.ipynb');
    handler.dispose();
  });

  it.each([undefined, 'deleted'] as const)(
    'saves the selected copy for status %s',
    async reason => {
      const { handler, actions, onSwitchDocument, get } = setup();
      handler.updateStatus({ originalPath: 'folder/Untitled.ipynb', reason });
      await sleep(20);
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
    }
  );

  it('blocks saving while status is unresolved and closes the dialog on disposal', async () => {
    const { handler, actions } = setup();
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    const saving = handler.ensureCanSave();
    const rejected = expect(saving).rejects.toHaveProperty(
      'name',
      'ModalCancelError'
    );
    await sleep(20);
    handler.updateStatus(null);
    await rejected;
    handler.updateStatus(null);
    await sleep(50);
    await expect(handler.ensureCanSave()).resolves.toBeUndefined();
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    handler.dispose();
    await sleep(50);
    expect(
      document.querySelector('.jp-CollaborationExternalChangeNotice')
    ).toBeNull();
    expect(actions.saveAs).not.toHaveBeenCalled();
  });
  it('updates an existing prompt when the file is deleted and allows closing', async () => {
    const { handler, onCloseDocument } = setup();
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    handler.updateStatus({ originalPath: 'Untitled.ipynb', reason: 'deleted' });
    await sleep(50);
    expect(
      document.querySelector('.jp-CollaborationExternalChangeNotice')!
        .textContent
    ).toContain('was deleted from disk');
    expect(
      document.querySelector('.jp-CollaborationExternalChangeNotice')!
        .textContent
    ).not.toContain('Load from disk');
    click('Close tab');
    await sleep(50);
    expect(onCloseDocument).toHaveBeenCalled();
    handler.dispose();
  });
  it('loads immediately without a dialog when automatic reloading is disabled', async () => {
    const { handler, onSwitchDocument } = setup(Promise.resolve(), {
      autoReload: () => false
    });
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    click('Load from disk');
    await sleep(20);
    expect(document.querySelector('.jp-Dialog')).toBeNull();
    expect(onSwitchDocument).toHaveBeenCalledWith('Untitled.ipynb');
    expect(
      document.querySelector('.jp-CollaborationExternalChangeNotice')
    ).toBeNull();
    handler.dispose();
  });

  it('automatically loads changes when enabled, but still reports deletion', async () => {
    const { handler, onSwitchDocument } = setup(Promise.resolve(), {
      autoReload: () => true
    });
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    expect(onSwitchDocument).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.jp-Dialog')).toBeNull();
    handler.updateStatus({ originalPath: 'Untitled.ipynb', reason: 'deleted' });
    await sleep(20);
    expect(onSwitchDocument).toHaveBeenCalledTimes(1);
    expect(
      document.querySelector('.jp-CollaborationExternalChangeNotice')!
        .textContent
    ).toContain('deleted');
    handler.dispose();
  });

  it('offers an explicit overwrite when saving and does not perform a second save', async () => {
    const { handler, actions, onSwitchDocument } = setup();
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    const saving = handler.ensureCanSave();
    const rejected = expect(saving).rejects.toHaveProperty(
      'name',
      'ModalCancelError'
    );
    await waitForDialog();
    click('Save to original file');
    await rejected;
    expect(actions.overwrite).toHaveBeenCalledWith('Untitled.ipynb');
    expect(onSwitchDocument).toHaveBeenCalledWith('Untitled.ipynb');
    expect(actions.saveAs).not.toHaveBeenCalled();
    handler.dispose();
  });
  it('resolves saves from the editor notice before the context conflict check', async () => {
    const { handler, beforeSave, actions } = setup();
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    const contextSave = jest.fn().mockResolvedValue(undefined);
    const saving = (async () => {
      await beforeSave();
      await contextSave();
    })();
    const rejected = expect(saving).rejects.toHaveProperty(
      'name',
      'ModalCancelError'
    );
    await waitForDialog();
    expect(document.querySelectorAll('.jp-Dialog')).toHaveLength(1);
    expect(document.querySelector('.jp-Dialog')!.textContent).toContain(
      'Save to original file'
    );
    expect(document.querySelector('.jp-Dialog')!.textContent).not.toContain(
      'Revert'
    );
    click('Cancel');
    await rejected;
    expect(contextSave).not.toHaveBeenCalled();
    expect(actions.overwrite).not.toHaveBeenCalled();
    handler.updateStatus(null);
    await beforeSave();
    handler.dispose();
  });
  it.each([undefined, 'deleted'] as const)(
    'saves directly to the original from the notice for status %s',
    async reason => {
      const { handler, actions, onSwitchDocument } = setup();
      handler.updateStatus({ originalPath: 'Untitled.ipynb', reason });
      await sleep(20);
      click('Save to original file');
      await sleep(20);
      expect(document.querySelector('.jp-Dialog')).toBeNull();
      expect(actions.overwrite).toHaveBeenCalledWith('Untitled.ipynb');
      expect(onSwitchDocument).toHaveBeenCalledWith('Untitled.ipynb');
      expect(actions.saveAs).not.toHaveBeenCalled();
      expect(
        document.querySelector('.jp-CollaborationExternalChangeNotice')
      ).toBeNull();
      handler.dispose();
    }
  );
  it('shows a read-only diff without resolving the notice', async () => {
    const onShowDiff = jest.fn().mockResolvedValue(undefined);
    const { handler, actions, onSwitchDocument } = setup(Promise.resolve(), {
      onShowDiff
    });
    handler.updateStatus({ originalPath: 'Untitled.ipynb' });
    await sleep(20);
    click('Show diff');
    await sleep(20);
    expect(onShowDiff).toHaveBeenCalledWith('Untitled.ipynb');
    expect(
      document.querySelector('.jp-CollaborationExternalChangeNotice')
    ).not.toBeNull();
    expect(document.querySelector('.jp-Dialog')).toBeNull();
    expect(actions.overwrite).not.toHaveBeenCalled();
    expect(actions.saveAs).not.toHaveBeenCalled();
    expect(onSwitchDocument).not.toHaveBeenCalled();
    handler.dispose();
  });

  it.each([undefined, 'deleted'] as const)(
    'hides diff when unavailable for %s',
    async reason => {
      const { handler } = setup(Promise.resolve(), {
        onShowDiff: reason === 'deleted' ? jest.fn() : undefined
      });
      handler.updateStatus({ originalPath: 'Untitled.ipynb', reason });
      await sleep(20);
      expect(
        document.querySelector('.jp-CollaborationExternalChangeNotice')!
          .textContent
      ).not.toContain('Show diff');
      handler.dispose();
    }
  );
});

// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { expect, galata, test } from '@jupyterlab/galata';
import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import { rm } from 'fs/promises';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { newInterceptedPage, ICollabWSControl } from './collab-ws-helpers';

/**
 * These tests exercise the "Edit Conflict" flow driven by document sessions:
 *
 * 1. The client edits a notebook and the edit is autosaved (so the client's
 *    last-known save hash matches the file on disk).
 * 2. The client loses its collaboration websocket and makes a further,
 *    unsaved local edit.
 * 3. While it is away, the room is evicted, the YStore database is deleted
 *    and the file is changed on disk, so the next room incarnation is
 *    rebuilt from changed content and rolls its document session ID.
 * 4. When the client reconnects, the server refuses to synchronize with it
 *    (its Yjs history belongs to the previous session). The client fetches
 *    the server content, sees both a local unsaved edit and a changed file
 *    (save-hash mismatch), and surfaces the "Edit Conflict" dialog with
 *    Dismiss / Revert / Show Diff / Save As options.
 *
 * Unlike the previous implementation (which relied on a Yjs integration
 * error timed against a fully-populated server document), this flow is
 * timing-independent and works with progressive document loading enabled;
 * these tests run against the default server config, which enables it.
 */

const YSTORE_DB = '/tmp/jupyter_ystore_ui_test.db';
const YSTORE_FILES = [YSTORE_DB, `${YSTORE_DB}-shm`, `${YSTORE_DB}-wal`];

const INITIAL_NOTEBOOK = {
  nbformat: 4,
  nbformat_minor: 5,
  metadata: {},
  cells: [
    {
      cell_type: 'code',
      id: 'cell-1',
      metadata: {},
      source: '',
      outputs: [],
      execution_count: null
    }
  ]
};

/**
 * The out-of-band change: a new cell is prepended and the original cell
 * loses the client's saved edit.
 */
const MODIFIED_NOTEBOOK = {
  ...INITIAL_NOTEBOOK,
  cells: [
    {
      cell_type: 'code',
      id: 'cell-0',
      metadata: {},
      source: 'print("new cell")',
      outputs: [],
      execution_count: null
    },
    INITIAL_NOTEBOOK.cells[0]
  ]
};

/**
 * Sets up the conflict scenario: open notebook, type something and let it
 * autosave, sever the collaboration websocket, make an unsaved edit, delete
 * the ystore, overwrite the notebook on disk, let the client reconnect.
 * Returns when the conflict dialog is visible.
 */
async function triggerConflict(
  page: IJupyterLabPageFixture,
  ws: ICollabWSControl,
  request: APIRequestContext,
  tmpPath: string,
  baseURL: string,
  notebookName: string
) {
  const notebookPath = `${tmpPath}/${notebookName}`;

  const createResp = await request.put(
    `${baseURL}/api/contents/${notebookPath}`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        type: 'notebook',
        format: 'json',
        content: INITIAL_NOTEBOOK
      })
    }
  );
  expect(createResp.ok()).toBeTruthy();

  await page.filebrowser.refresh();
  await page.notebook.open(notebookName);

  // Dismiss kernel selection dialog if it appears.
  const noKernelBtn = page
    .locator('.jp-Dialog')
    .getByRole('button', { name: 'No Kernel' });
  try {
    await noKernelBtn.waitFor({ state: 'visible', timeout: 3000 });
    await noKernelBtn.click();
    await page.locator('.jp-Dialog').waitFor({ state: 'hidden', timeout: 3000 });
  } catch {
    // No kernel dialog appeared.
  }

  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.type('x = 1');
  await page.notebook.leaveCellEditingMode(0);

  // 1. Wait for the edit to be autosaved so that the client records the
  //    hash of the saved file (the base for conflict detection).
  await expect(async () => {
    const resp = await request.get(
      `${baseURL}/api/contents/${notebookPath}?content=1`
    );
    expect(resp.ok()).toBeTruthy();
    const model = await resp.json();
    expect(model.content.cells[0].source).toContain('x = 1');
  }).toPass({ timeout: 15000 });
  // Give the save-related state (hash, dirty) a moment to sync to the client.
  await page.waitForTimeout(1000);

  // 2. The client's collaboration websocket is severed and the user keeps
  //    editing: these edits are unsaved, which is what makes the upcoming
  //    divergence a real conflict.
  await ws.sever();
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.press('End');
  await page.keyboard.type(' # local edit');
  await page.notebook.leaveCellEditingMode(0);

  // 3. Wait for room eviction (document_cleanup_delay=1s in the test
  //    config).
  await page.waitForTimeout(3000);

  // 4. Delete the ystore database so the next room incarnation is rebuilt
  //    from disk instead of restoring the previous Yjs history.
  await Promise.all(YSTORE_FILES.map(file => rm(file, { force: true })));

  // 5. Overwrite the notebook on disk: the room will be rebuilt from
  //    content that diverges from both the client's content and its
  //    last-known save, so the document session ID rolls.
  const putResp = await request.put(
    `${baseURL}/api/contents/${notebookPath}`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        type: 'notebook',
        format: 'json',
        content: MODIFIED_NOTEBOOK
      })
    }
  );
  expect(putResp.ok()).toBeTruthy();

  // 6. Let the client back in. y-websocket reconnects claiming the old
  //    document session; the server refuses before any Yjs sync and the
  //    client shows the conflict dialog (local unsaved edit + changed file).
  ws.restore();

  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog).toContainText('Edit Conflict');
  return dialog;
}

test.describe.serial('Conflict handling', () => {
  const notebookName = 'conflict_test.ipynb';
  let page: IJupyterLabPageFixture;
  let ws: ICollabWSControl;
  let context: BrowserContext;

  test.beforeEach(async ({ browser, baseURL, tmpPath, waitForApplication }) => {
    ({ page, ws, context } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication
    }));
  });

  test.afterEach(async ({ request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${notebookName}`).catch(() => {});
    await page
      .unrouteAll({ behavior: 'ignoreErrors' })
      .catch(() => undefined);
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  });

  test('shows a conflict dialog and dismisses it', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    expect(
      await dialog.locator('.jp-Dialog-content').screenshot()
    ).toMatchSnapshot('conflict-dialog.png');
    await dialog.getByRole('button', { name: 'Dismiss' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('toolbar indicator allows resolving a dismissed conflict', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    await dialog.getByRole('button', { name: 'Dismiss' }).click();
    await expect(dialog).not.toBeVisible();

    // The document stays disconnected from collaboration: a warning
    // indicator shows in the document toolbar.
    const indicator = page.locator('.jp-ConflictIndicator');
    await expect(indicator).toBeVisible();

    // Clicking it re-opens the conflict dialog.
    await indicator.click();
    const reopened = page.locator('.jp-Dialog');
    await expect(reopened).toBeVisible();
    await expect(reopened).toContainText('Edit Conflict');

    // Resolving through it adopts the server version and removes the
    // indicator.
    await reopened.getByRole('button', { name: 'Revert' }).click();
    await expect(page.locator('.jp-Cell')).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('.jp-Cell').first()).toContainText('new cell');
    await expect(page.locator('.jp-ConflictIndicator')).toHaveCount(0);
  });

  test('saving is refused while a conflict is unresolved', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    // While the conflict is pending the document is disconnected from the
    // room, and saving goes *through* the room. Reporting a successful save
    // here would tell the user their work is on disk when it never left the
    // browser.
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    await dialog.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.jp-ConflictIndicator')).toBeVisible();

    await page.keyboard.press('Control+s');
    // The save must not silently succeed: the file on disk keeps the server
    // content, without the local edit.
    await page.waitForTimeout(3000);
    const resp = await request.get(
      `${baseURL}/api/contents/${tmpPath}/${notebookName}?content=1`
    );
    expect(resp.ok()).toBeTruthy();
    const model = await resp.json();
    expect(JSON.stringify(model.content.cells)).not.toContain('local edit');
  });

  test('Revert button adopts the server version', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    await dialog.getByRole('button', { name: 'Revert' }).click();

    // After revert the notebook should show the server state: 2 cells.
    await expect(page.locator('.jp-Cell')).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('.jp-Cell').first()).toContainText('new cell');
    // The local unsaved edit was discarded.
    await expect(page.locator('.jp-Notebook')).not.toContainText('local edit');
  });

  test('Save As button opens the save-as dialog', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    await dialog.getByRole('button', { name: 'Save As' }).click();

    // docmanager:save-as replaces the conflict dialog with a path input dialog.
    const saveAsDialog = page.locator('.jp-Dialog');
    await expect(saveAsDialog.locator('input')).toBeVisible({ timeout: 5000 });

    // Cancel without saving.
    await saveAsDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(saveAsDialog).not.toBeVisible();
  });

  test('Show Diff button opens a diff widget', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    await dialog.getByRole('button', { name: 'Show Diff' }).click();

    // The diff widget should appear as a main area tab.
    const diffWidget = page.locator('.jp-MainAreaWidget:has(.nbdime-Widget)');
    await expect(diffWidget).toBeVisible({ timeout: 10000 });

    expect(await diffWidget.screenshot()).toMatchSnapshot('conflict-diff.png');
  });

  test('Save Local As button in diff toolbar opens the save-as dialog', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    await dialog.getByRole('button', { name: 'Show Diff' }).click();

    const diffWidget = page.locator('.jp-MainAreaWidget:has(.nbdime-Widget)');
    await expect(diffWidget).toBeVisible({ timeout: 10000 });

    await diffWidget.getByRole('button', { name: 'Save Local As' }).click();

    // docmanager:save-as opens a path-input dialog.
    const saveAsDialog = page.locator('.jp-Dialog');
    await expect(saveAsDialog.locator('input')).toBeVisible({ timeout: 5000 });

    // Cancel without saving.
    await saveAsDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(saveAsDialog).not.toBeVisible();
  });

  test('Revert to Remote button in diff toolbar adopts the server version', async ({
    request,
    tmpPath,
    baseURL
  }) => {
    const dialog = await triggerConflict(
      page,
      ws,
      request,
      tmpPath,
      baseURL!,
      notebookName
    );
    await dialog.getByRole('button', { name: 'Show Diff' }).click();

    const diffWidget = page.locator('.jp-MainAreaWidget:has(.nbdime-Widget)');
    await expect(diffWidget).toBeVisible({ timeout: 10000 });

    await diffWidget.getByRole('button', { name: 'Revert to Remote' }).click();

    // The diff widget closes and the notebook shows the server state.
    await expect(diffWidget).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.jp-Cell')).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('.jp-Cell').first()).toContainText('new cell');
  });
});

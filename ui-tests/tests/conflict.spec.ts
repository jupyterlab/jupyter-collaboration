// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { expect, galata, test } from '@jupyterlab/galata';
import { unlink } from 'fs/promises';
import type { Page, APIRequestContext } from '@playwright/test';

/**
 * A minimal notebook with one cell.
 *
 * When the room is recreated after a NEW CELL is inserted at the beginning,
 * _apply_deterministic_source_content (which pins client_id=0) shifts the
 * clock positions for all subsequent items (including the source Text branch
 * of the original cell).
 *
 * A client that was connected to the original room holds a local YDoc edit
 * whose parent references the source Text at clock position N. After the room
 * is recreated with a new cell prepended, the source Text is at position N+K
 * where K is the number of new items. The parent reference (0, N) now points
 * to a different Yjs item type, so applying the client's buffered SYNC_STEP2
 * raises "block parent <0#N> must be deleted or shared ref type" on the server.
 */
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

const MODIFIED_NOTEBOOK = {
  ...INITIAL_NOTEBOOK,
  cells: [
    {
      cell_type: 'code',
      id: 'cell-0',
      metadata: { trusted: true, collapsed: false, scrolled: false },
      source: 'print("new cell")',
      outputs: [],
      execution_count: null
    },
    INITIAL_NOTEBOOK.cells[0]
  ]
};

/**
 * Sets up the conflict scenario: open notebook, type something, go offline,
 * delete ystore, overwrite notebook on disk, come back online.
 * Returns when the conflict dialog is visible.
 */
async function triggerConflict(
  page: Page,
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

  // Give y-websocket a moment to deliver the SYNC_UPDATE to the server.
  await page.waitForTimeout(500);

  // 1. The browser goes offline.
  await page.context().setOffline(true);

  // 2. Wait for room eviction and WebSocket timeout detection.
  await page.waitForTimeout(10000);

  // 3. Delete the ystore database to force Room R2 to rebuild from disk
  //    via _apply_deterministic_source_content (client_id=0). Without this,
  //    SQLiteYStore preserves R1's history and R2 uses aset(), keeping the
  //    source Text at the original clock position → no conflict.
  await unlink('/tmp/jupyter_ystore_ui_test.db');

  // 4. Overwrite the notebook on disk to insert a NEW CELL at the beginning.
  //    The Jupyter server normalises cell dicts to nbformat order:
  //      {cell_type, execution_count, id, metadata, outputs, source}
  //    so source Text lands at Yjs clock +7 from the cell Map's position
  //    (0=Map, 1=cell_type, 2=execution_count, 3=id, 4=metadata YMap,
  //     5=key1, 6=key2, 7=key3 [ContentAny], 8=outputs, 9=source YText).
  //    With THREE metadata keys on cell-0, position (0,7) becomes the third
  //    metadata entry (ContentAny).  The client's stale edit has parent=(0,7)
  //    which now points to a non-shared-ref type → RuntimeError on the server.
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

  // 5. Come back online. y-websocket reconnects; the server creates
  //    Room R2 from the modified file. The browser's YDoc still has the
  //    edit referencing source Text at its R1 clock position. The stale
  //    parent reference now points to a non-Text Yjs item.
  await page.context().setOffline(false);

  const dialog = page.locator('.jp-Dialog');
  await expect(dialog).toBeVisible({ timeout: 15000 });
  await expect(dialog).toContainText('Edit Conflict');
  return dialog;
}

test.describe.serial('Conflict handling', () => {
  const notebookName = 'conflict_test.ipynb';

  test.afterEach(async ({ page, request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${notebookName}`).catch(() => {});
    await page.close();
  });

  test(
    'shows a conflict dialog and dismisses it',
    async ({ page, request, tmpPath, baseURL }) => {
      const dialog = await triggerConflict(
        page,
        request,
        tmpPath,
        baseURL,
        notebookName
      );
      await dialog.getByRole('button', { name: 'Dismiss' }).click();
      await expect(dialog).not.toBeVisible();
    }
  );

  test(
    'Revert button reloads the document from disk',
    async ({ page, request, tmpPath, baseURL }) => {
      const dialog = await triggerConflict(
        page,
        request,
        tmpPath,
        baseURL,
        notebookName
      );
      await dialog.getByRole('button', { name: 'Revert' }).click();

      // After reload, handle any follow-up dialog (kernel selection or
      // reload confirmation).
      const followUp = page.locator('.jp-Dialog');
      try {
        await followUp.waitFor({ state: 'visible', timeout: 3000 });
        const noKernel = followUp.getByRole('button', { name: 'No Kernel' });
        if (await noKernel.isVisible({ timeout: 300 })) {
          await noKernel.click();
        } else {
          await followUp.locator('.jp-mod-accept').click();
        }
        await expect(followUp).not.toBeVisible({ timeout: 5000 });
      } catch {
        // No follow-up dialog.
      }

      // After reload the notebook should show the server state: 2 cells.
      await expect(page.locator('.jp-Cell')).toHaveCount(2, { timeout: 5000 });
    }
  );

  test(
    'Save As button opens the save-as dialog',
    async ({ page, request, tmpPath, baseURL }) => {
      const dialog = await triggerConflict(
        page,
        request,
        tmpPath,
        baseURL,
        notebookName
      );
      await dialog.getByRole('button', { name: 'Save As' }).click();

      // docmanager:save-as replaces the conflict dialog with a path input dialog.
      const saveAsDialog = page.locator('.jp-Dialog');
      await expect(saveAsDialog.locator('input')).toBeVisible({ timeout: 5000 });

      // Cancel without saving.
      await saveAsDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(saveAsDialog).not.toBeVisible();
    }
  );

  test(
    'Show Diff button opens a diff widget',
    async ({ page, request, tmpPath, baseURL }) => {
      const dialog = await triggerConflict(
        page,
        request,
        tmpPath,
        baseURL,
        notebookName
      );
      await dialog.getByRole('button', { name: 'Show Diff' }).click();

      // The diff widget should appear as a main area tab.
      const diffWidget = page.locator('.jp-MainAreaWidget .nbdime-Widget');
      await expect(diffWidget).toBeVisible({ timeout: 10000 });

      await diffWidget.screenshot({ path: 'conflict-diff.png' });
    }
  );
});

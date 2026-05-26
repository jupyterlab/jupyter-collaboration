// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { expect, galata, test } from '@jupyterlab/galata';
import { unlink } from 'fs/promises';

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

test.describe.serial('Conflict handling', () => {
  const notebookName = 'conflict_test.ipynb';

  test.afterEach(async ({ page, request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${notebookName}`).catch(() => {
      // ignore if already deleted
    });
    await page.close();
  });

  test(
    'shows a conflict dialog when document structure changes between reconnections',
    async ({ page, request, tmpPath, baseURL }) => {
      const notebookPath = `${tmpPath}/${notebookName}`;

      // Upload the initial notebook.
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

      // Open the notebook — this connects the browser's y-websocket to the server.
      await page.filebrowser.refresh();
      await page.notebook.open(notebookName);

      // Type something in cell 0.
      await page.notebook.enterCellEditingMode(0);
      await page.keyboard.type('x = 1');
      await page.notebook.leaveCellEditingMode(0);

      // Give y-websocket a moment to deliver the SYNC_UPDATE to the server.
      await page.waitForTimeout(500);

      // Simulate the production failure scenario
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
      const modifiedNotebook = {
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
      const putResp = await request.put(
        `${baseURL}/api/contents/${notebookPath}`,
        {
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({
            type: 'notebook',
            format: 'json',
            content: modifiedNotebook
          })
        }
      );
      expect(putResp.ok()).toBeTruthy();

      // 5. Come back online. y-websocket reconnects; the server creates
      //    Room R2 from the modified file. The browser's YDoc still has the
      //    edit referencing source Text at its R1 clock position. The stale
      //    parent reference now points to a non-Text Yjs item.
      await page.context().setOffline(false);

      // 6. The frontend should receive the CONFLICT message and show a dialog.
      const dialog = page.locator('.jp-Dialog');
      await expect(dialog).toBeVisible({ timeout: 15000 });
      await expect(dialog).toContainText('Edit Conflict');

      // Dismiss the dialog so the test can clean up.
      await page.locator('.jp-Dialog .jp-mod-accept').click();
      await expect(dialog).not.toBeVisible();
    }
  );
});

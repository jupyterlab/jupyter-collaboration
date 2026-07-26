// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

//
// These tests restart the Jupyter Server mid-way to reproduce the scenarios
// where a client reconnects to a server whose in-memory state was lost:
//
// - with a persisted YStore the Yjs history (and the document session) is
//   restored, so the client reconnects silently;
// - without a YStore the room is rebuilt from disk and the document session
//   rolls; the client reconciles (silently when content converged or only
//   local unsaved edits exist; with the "Edit Conflict" dialog when the
//   file also changed), and never duplicates cells (issue #594) nor gets
//   stuck on stale content (issue #597).
//
// Because they kill and respawn the server process, they MUST be run in
// isolation from the other UI tests (see `playwright.restart.config.js` and
// the `testIgnore` entry in `playwright.config.js`).
//
// Run with:  jlpm test:restart
//

import { expect, galata, test } from '@jupyterlab/galata';
import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rm } from 'fs/promises';
import type { ChildProcess } from 'child_process';
import type { Page } from '@playwright/test';
import {
  killPortHolder,
  startServer,
  stopServer,
  waitForServer
} from './restart-helpers';
import { newInterceptedPage } from './collab-ws-helpers';

// Stable root dir so the notebooks survive the restart (galata otherwise
// picks a fresh temp dir on every launch).
const ROOT_DIR = path.join(os.tmpdir(), 'jupyter_restart_test_root');
const YSTORE_DB = '/tmp/jupyter_ystore_ui_test.db';
const YSTORE_FILES = [YSTORE_DB, `${YSTORE_DB}-shm`, `${YSTORE_DB}-wal`];

const EMPTY_NOTEBOOK = {
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

async function dismissKernelDialog(page: Page): Promise<void> {
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
}

/**
 * Dismiss transient dialogs which JupyterLab may show while the server is
 * being restarted (e.g. "Server Connection Error"), without touching the
 * "Edit Conflict" dialog these tests assert on.
 */
async function dismissConnectionErrorDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const dialog = page.locator('.jp-Dialog').first();
    if (!(await dialog.isVisible().catch(() => false))) {
      return;
    }
    const text = (await dialog.textContent().catch(() => '')) ?? '';
    if (text.includes('Edit Conflict')) {
      return;
    }
    const dismiss = dialog.getByRole('button', {
      name: /Dismiss|Ok|OK|Cancel/
    });
    if (await dismiss.first().isVisible().catch(() => false)) {
      await dismiss.first().click().catch(() => undefined);
      await page.waitForTimeout(500);
    } else {
      return;
    }
  }
}

const conflictDialog = (page: Page) =>
  page.locator('.jp-Dialog:has-text("Edit Conflict")');

async function createNotebook(
  page: IJupyterLabPageFixture,
  tmpPath: string,
  name: string
): Promise<void> {
  const resp = await page.request.put(
    `http://localhost:8888/api/contents/${tmpPath}/${name}`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        type: 'notebook',
        format: 'json',
        content: EMPTY_NOTEBOOK
      })
    }
  );
  expect(resp.ok()).toBeTruthy();
  await page.filebrowser.refresh();
  await page.notebook.open(name);
  await dismissKernelDialog(page);
}

async function typeInFirstCell(
  page: IJupyterLabPageFixture,
  text: string
): Promise<void> {
  await page.notebook.enterCellEditingMode(0);
  await page.keyboard.press('End');
  await page.keyboard.type(text);
  await page.notebook.leaveCellEditingMode(0);
}

async function readCellsOnDisk(
  page: Page,
  tmpPath: string,
  name: string
): Promise<string> {
  const resp = await page.request.get(
    `http://localhost:8888/api/contents/${tmpPath}/${name}?content=1`
  );
  expect(resp.ok()).toBeTruthy();
  const model = await resp.json();
  return JSON.stringify(model.content.cells);
}

async function waitForOnDisk(
  page: Page,
  tmpPath: string,
  name: string,
  text: string
): Promise<void> {
  await expect(async () => {
    const resp = await page.request.get(
      `http://localhost:8888/api/contents/${tmpPath}/${name}?content=1`
    );
    expect(resp.ok()).toBeTruthy();
    const model = await resp.json();
    expect(JSON.stringify(model.content.cells)).toContain(text);
  }).toPass({ timeout: 15000 });
}

test.describe.serial('Server restart persistence', () => {
  let server: ChildProcess;

  test.beforeAll(async () => {
    // A stray server from an aborted previous run would otherwise shadow
    // the one this suite manages.
    await killPortHolder();
    fs.rmSync(ROOT_DIR, { recursive: true, force: true });
    fs.mkdirSync(ROOT_DIR, { recursive: true });
    await Promise.all(YSTORE_FILES.map(file => rm(file, { force: true })));
    server = startServer(ROOT_DIR);
    await waitForServer(true);
  });

  test.afterAll(async () => {
    if (server) {
      await stopServer(server);
    }
  });

  test('notebook content persists across a server restart', async ({
    page,
    tmpPath,
    browser,
    baseURL,
    waitForApplication
  }) => {
    const name = 'restart_persistence.ipynb';
    const cellSource = "print('persisted across restart')";
    await createNotebook(page, tmpPath, name);
    await typeInFirstCell(page, cellSource);
    await waitForOnDisk(page, tmpPath, name, 'persisted across restart');
    await page.close();

    // Restart the server. The collaborative room is destroyed and must be
    // rebuilt from disk / ystore on the next open.
    await stopServer(server);
    server = startServer(ROOT_DIR);
    await waitForServer(true);

    // A fresh client opens the notebook after the restart.
    const { page: newPage } = await galata.newPage({
      baseURL: baseURL!,
      browser,
      mockUser: true,
      tmpPath,
      waitForApplication
    });
    try {
      await newPage.filebrowser.refresh();
      await newPage.notebook.open(name);
      await dismissKernelDialog(newPage);

      // The cell content must show up (not a blank document), and only once.
      await expect(newPage.locator('.jp-Cell').first()).toContainText(
        cellSource,
        { timeout: 15000 }
      );
      await expect(newPage.locator('.jp-Cell')).toHaveCount(1);
    } finally {
      await newPage.close();
    }
  });

  test('client reconnects silently after a restart with a persisted ystore', async ({
    browser,
    baseURL,
    tmpPath,
    waitForApplication
  }) => {
    // The websockets are proxied (see collab-ws-helpers) so that the server
    // going away deterministically closes the client side and triggers the
    // y-websocket reconnection machinery.
    const { page, ws, context } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication
    });
    try {
      const name = 'restart_with_ystore.ipynb';
      await createNotebook(page, tmpPath, name);
      await typeInFirstCell(page, 'before = 1');
      await waitForOnDisk(page, tmpPath, name, 'before = 1');

      // Restart the server, KEEPING the ystore: the room's Yjs history (and
      // its document session) is restored, so the open tab reconnects and
      // resumes collaboration without any dialog and without a page reload.
      await stopServer(server);
      // Sever the zombie websocket legs: the browser cannot reliably
      // observe the death of the server on its own (the closing handshake
      // has no peer), so the proxy closes the client side explicitly and
      // refuses reconnection attempts until the new server is up.
      await ws.sever();
      server = startServer(ROOT_DIR);
      await waitForServer(true);
      ws.restore();

      // Give the client time to reconnect (y-websocket backoff).
      await page.waitForTimeout(5000);
      await dismissConnectionErrorDialogs(page);
      await expect(conflictDialog(page)).toHaveCount(0);
      await expect(page.locator('.jp-Cell')).toHaveCount(1);
      await expect(page.locator('.jp-Cell').first()).toContainText(
        'before = 1'
      );

      // Edits made after the restart reach the disk again.
      await typeInFirstCell(page, '\nafter = 2');
      await waitForOnDisk(page, tmpPath, name, 'after = 2');
    } finally {
      await page
        .unrouteAll({ behavior: 'ignoreErrors' })
        .catch(() => undefined);
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('saved content is not duplicated after a restart without ystore', async ({
    browser,
    baseURL,
    tmpPath,
    waitForApplication
  }) => {
    // Issue #594: saved cells used to be duplicated when the tab stayed
    // open across a server restart with no (or a deleted) YStore.
    const { page, ws, context } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication
    });
    try {
      const name = 'restart_no_ystore.ipynb';
      await createNotebook(page, tmpPath, name);
      await typeInFirstCell(page, 'saved = 1');
      await waitForOnDisk(page, tmpPath, name, 'saved = 1');
      await page.waitForTimeout(1000);

      await stopServer(server);
      await ws.sever();
      await Promise.all(YSTORE_FILES.map(file => rm(file, { force: true })));
      server = startServer(ROOT_DIR);
      await waitForServer(true);
      ws.restore();

      // The document session rolled (history rebuilt from disk); the client
      // must adopt the new session silently: same content, no dialog and,
      // crucially, no duplicated cells.
      await page.waitForTimeout(5000);
      await dismissConnectionErrorDialogs(page);
      await expect(page.locator('.jp-Cell').first()).toContainText(
        'saved = 1',
        { timeout: 20000 }
      );
      await expect(conflictDialog(page)).toHaveCount(0);
      await expect(page.locator('.jp-Cell')).toHaveCount(1);

      // The document is live again.
      await typeInFirstCell(page, '\nresumed = 2');
      await waitForOnDisk(page, tmpPath, name, 'resumed = 2');
    } finally {
      await page
        .unrouteAll({ behavior: 'ignoreErrors' })
        .catch(() => undefined);
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('conflict dialog shows when the file changed and local edits exist', async ({
    browser,
    baseURL,
    tmpPath,
    waitForApplication
  }) => {
    const { page, ws, context } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication
    });
    try {
      const name = 'restart_conflict.ipynb';
      await createNotebook(page, tmpPath, name);
      await typeInFirstCell(page, 'mine = 1');
      await waitForOnDisk(page, tmpPath, name, 'mine = 1');
      await page.waitForTimeout(1000);

      await stopServer(server);
      await ws.sever();
      // With the server down, further edits stay local (unsaved).
      await typeInFirstCell(page, '\nunsaved = 2');
      // The file changes on disk while the server is down, and the ystore
      // is lost: the next room incarnation diverges from both the client
      // content and its last known save.
      await Promise.all(YSTORE_FILES.map(file => rm(file, { force: true })));
      const notebookOnDisk = path.join(ROOT_DIR, tmpPath, name);
      const modified = {
        ...EMPTY_NOTEBOOK,
        cells: [
          {
            cell_type: 'code',
            id: 'cell-1',
            metadata: {},
            source: 'theirs = 3',
            outputs: [],
            execution_count: null
          }
        ]
      };
      fs.writeFileSync(notebookOnDisk, JSON.stringify(modified));
      server = startServer(ROOT_DIR);
      await waitForServer(true);
      ws.restore();

      // A real conflict: the client must be asked, not silently merged.
      await expect(conflictDialog(page)).toBeVisible({ timeout: 30000 });
      await conflictDialog(page)
        .getByRole('button', { name: 'Revert' })
        .click();
      await expect(page.locator('.jp-Cell').first()).toContainText(
        'theirs = 3',
        { timeout: 15000 }
      );
      await expect(page.locator('.jp-Cell')).toHaveCount(1);
    } finally {
      await page
        .unrouteAll({ behavior: 'ignoreErrors' })
        .catch(() => undefined);
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('reopened notebook is editable and tracks its dirty state (#601)', async ({
    page,
    tmpPath,
    browser,
    baseURL,
    waitForApplication
  }) => {
    // Issue #601, following its reproduction exactly: put content in a cell,
    // close JupyterLab, stop the server, start it again and reopen. The
    // notebook came back empty, and typing into it did not mark the document
    // dirty, so the user could not tell whether their work was being kept.
    const name = 'restart_reopen.ipynb';
    await createNotebook(page, tmpPath, name);
    await typeInFirstCell(page, 'value = 601');
    await waitForOnDisk(page, tmpPath, name, 'value = 601');
    await page.close();

    await stopServer(server);
    server = startServer(ROOT_DIR);
    await waitForServer(true);

    const { page: newPage } = await galata.newPage({
      baseURL: baseURL!,
      browser,
      mockUser: true,
      tmpPath,
      waitForApplication
    });
    try {
      await newPage.filebrowser.refresh();
      await newPage.notebook.open(name);
      await dismissKernelDialog(newPage);

      // Half one of the issue: the content is there rather than blank.
      await expect(newPage.locator('.jp-Cell').first()).toContainText(
        'value = 601',
        { timeout: 20000 }
      );
      await expect(newPage.locator('.jp-Cell')).toHaveCount(1);

      // Half two: the document still tracks its own dirty state. The tab
      // gains `jp-mod-dirty` while there are unsaved changes and loses it
      // once the room has written them out.
      const tab = newPage.locator('.lm-TabBar-tab.jp-mod-dirty');
      await expect(tab).toHaveCount(0);

      await typeInFirstCell(newPage, '\nmore = True');
      await expect(tab).toHaveCount(1, { timeout: 10000 });

      // And the edit really does reach the file, which is what the dirty
      // indicator is promising.
      await waitForOnDisk(newPage, tmpPath, name, 'more = True');
      await expect(tab).toHaveCount(0, { timeout: 15000 });
    } finally {
      await newPage.close();
    }
  });

  // The notebook file is the source of truth whenever it disagrees with the
  // YStore. If the server goes down before an edit has been written out, that
  // edit exists only in the YStore, and on the next start
  // `DocumentRoom.initialize` resolves the disagreement by taking the file and
  // discarding the YStore content (the server log says "Content in file ... is
  // out-of-sync with the ystore", then "loaded from file"). The edit is
  // dropped, which is the intended outcome: the YStore is a cache of the
  // editing history, not a second copy of the document, so it never gets to
  // overrule what is on disk. This rule predates the branch and is unchanged
  // by it, and the test is here to keep it deliberate.
  //
  // Not to be confused with the failure reported in #601, which the test above
  // covers: that one came from a hole in the recorded update stream, left by a
  // write made after the YStore snapshot but before the update observer was
  // subscribed, and is fixed on main by #607.
  test('the file wins over YStore edits that never reached it', async ({
    page,
    tmpPath,
    browser,
    baseURL,
    waitForApplication
  }) => {
    const name = 'restart_pending_save.ipynb';
    const onDisk = 'value_on_disk = 1';
    const neverSaved = 'value_only_in_ystore = 2';

    // Start from a state both sides agree on: an edit that does reach the file.
    await createNotebook(page, tmpPath, name);
    await typeInFirstCell(page, onDisk);
    await waitForOnDisk(page, tmpPath, name, onDisk);
    await page.close();

    // Autosave is pushed out of the way so the next edit is deterministically
    // still pending when the server goes down.
    await stopServer(server);
    server = startServer(ROOT_DIR, ['--YDocExtension.document_save_delay=120']);
    await waitForServer(true);

    const { page: editPage } = await galata.newPage({
      baseURL: baseURL!,
      browser,
      mockUser: true,
      tmpPath,
      waitForApplication
    });
    try {
      await editPage.filebrowser.refresh();
      await editPage.notebook.open(name);
      await dismissKernelDialog(editPage);
      await expect(editPage.locator('.jp-Cell').first()).toContainText(onDisk, {
        timeout: 20000
      });

      await typeInFirstCell(editPage, `\n${neverSaved}`);
      // Long enough to reach the room, and so the YStore, but not the file.
      await editPage.waitForTimeout(3000);

      // The premise of the test: the two sides now disagree.
      expect(await readCellsOnDisk(editPage, tmpPath, name)).not.toContain(
        neverSaved
      );
    } finally {
      await editPage.close();
    }

    await stopServer(server);
    server = startServer(ROOT_DIR);
    await waitForServer(true);

    const { page: newPage } = await galata.newPage({
      baseURL: baseURL!,
      browser,
      mockUser: true,
      tmpPath,
      waitForApplication
    });
    try {
      await newPage.filebrowser.refresh();
      await newPage.notebook.open(name);
      await dismissKernelDialog(newPage);

      const cell = newPage.locator('.jp-Cell').first();
      await expect(cell).toContainText(onDisk, { timeout: 20000 });
      // The unsaved edit is gone, and stays gone rather than arriving late.
      await expect(cell).not.toContainText(neverSaved);
      await newPage.waitForTimeout(2000);
      await expect(cell).not.toContainText(neverSaved);
      expect(await readCellsOnDisk(newPage, tmpPath, name)).not.toContain(
        neverSaved
      );
    } finally {
      await newPage.close();
    }
  });
});

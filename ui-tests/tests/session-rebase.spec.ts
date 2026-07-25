// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { expect, galata, test } from '@jupyterlab/galata';
import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import type { User } from '@jupyterlab/services';
import { rm } from 'fs/promises';
import type { Page, APIRequestContext } from '@playwright/test';
import { newInterceptedPage } from './collab-ws-helpers';

/**
 * These tests exercise the silent document-session reconciliation paths:
 * the cases in which a client whose Yjs history diverged from the server
 * room (server restart without a persisted YStore, room eviction with a
 * deleted YStore, out-of-band file changes) recovers WITHOUT bothering the
 * user with a dialog and, crucially, without duplicating any cells:
 *
 * - identical content: the client discards its local Yjs history and
 *   rejoins the new session (issue #594; historically this duplicated
 *   every cell);
 * - unchanged file + unsaved local edits: if the rebuilt history replays
 *   identical content the session is even kept and the offline edits merge
 *   through plain Yjs sync; if the session rolled, the client rejoins and
 *   re-applies its edits on top (semantic rebase);
 * - changed file + no local edits: the stale client catches up to the new
 *   content (issue #597; historically the client was stuck on the old
 *   content).
 *
 * They run against the default test server config, i.e. WITH progressive
 * document loading enabled; session-based divergence detection does not
 * depend on document load timing.
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

const conflictDialog = (page: Page) =>
  page.locator('.jp-Dialog:has-text("Edit Conflict")');

async function createNotebook(
  request: APIRequestContext,
  baseURL: string,
  notebookPath: string
): Promise<void> {
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
}

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

async function openNotebook(
  page: IJupyterLabPageFixture,
  notebookName: string
): Promise<void> {
  await page.filebrowser.refresh();
  await page.notebook.open(notebookName);
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

async function waitForOnDisk(
  request: APIRequestContext,
  baseURL: string,
  notebookPath: string,
  text: string
): Promise<void> {
  await expect(async () => {
    const resp = await request.get(
      `${baseURL}/api/contents/${notebookPath}?content=1`
    );
    expect(resp.ok()).toBeTruthy();
    const model = await resp.json();
    expect(JSON.stringify(model.content.cells)).toContain(text);
  }).toPass({ timeout: 15000 });
}

/**
 * Wait for the server to evict the room after the websocket was severed
 * (document_cleanup_delay=1s in the test config), then delete the YStore
 * database so the next room incarnation is rebuilt from disk.
 */
async function evictRoomAndDeleteYStore(page: Page): Promise<void> {
  await page.waitForTimeout(3000);
  await Promise.all(YSTORE_FILES.map(file => rm(file, { force: true })));
}

/**
 * The document session the server currently holds for a document.
 *
 * Tests assert on it to pin down *which* reconciliation path they exercise:
 * the observable outcome (right content, no dialog, no duplicated cells) is
 * the same whether the session was kept or rolled, so without this a test
 * meant to cover the rebase would keep passing if the session silently
 * stopped rolling.
 */
async function documentSessionId(
  request: APIRequestContext,
  baseURL: string,
  notebookPath: string
): Promise<string> {
  const resp = await request.put(
    `${baseURL}/api/collaboration/session/${notebookPath}`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ format: 'json', type: 'notebook' })
    }
  );
  expect(resp.ok()).toBeTruthy();
  const model = await resp.json();
  expect(model.documentSessionId).toBeTruthy();
  return model.documentSessionId as string;
}

test.describe.serial('Document session reconciliation', () => {
  const notebookName = 'session_rebase_test.ipynb';

  test.afterEach(async ({ request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${notebookName}`).catch(() => {});
  });

  test('saved changes survive a history rebuild without duplication', async ({
    browser,
    request,
    tmpPath,
    baseURL,
    waitForApplication
  }) => {
    // Issue #594: cells used to get duplicated when a client reconnected to
    // a room rebuilt from disk (no YStore) after its edits were saved.
    const { page, ws, context } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication
    });
    try {
      const notebookPath = `${tmpPath}/${notebookName}`;
      await createNotebook(request, baseURL!, notebookPath);
      await openNotebook(page, notebookName);

      await typeInFirstCell(page, 'x = 1');
      await waitForOnDisk(request, baseURL!, notebookPath, 'x = 1');
      // Let the save-related state (hash, dirty) sync back to the client.
      await page.waitForTimeout(1000);
      const sessionBefore = await documentSessionId(
        request,
        baseURL!,
        notebookPath
      );

      await ws.sever();
      await evictRoomAndDeleteYStore(page);
      ws.restore();

      // The client adopts the new session silently: same content, no
      // dialog, and crucially NO duplicated cells.
      await expect(page.locator('.jp-Cell')).toHaveCount(1, {
        timeout: 15000
      });
      await expect(page.locator('.jp-Cell').first()).toContainText('x = 1', {
        timeout: 15000
      });
      await page.waitForTimeout(2000);
      await expect(conflictDialog(page)).toHaveCount(0);
      await expect(page.locator('.jp-Cell')).toHaveCount(1);

      // The document is live again: further edits reach the disk. This also
      // establishes that the client rejoined — the assertions above hold on
      // the local document alone.
      await typeInFirstCell(page, '\ny = 2');
      await waitForOnDisk(request, baseURL!, notebookPath, 'y = 2');

      // The lineage advanced past its founding rebuild when the edit was
      // saved, so the rebuild founds a new one and the client had to
      // reconcile rather than resynchronize onto it.
      expect(
        await documentSessionId(request, baseURL!, notebookPath)
      ).not.toEqual(sessionBefore);
    } finally {
      await page
        .unrouteAll({ behavior: 'ignoreErrors' })
        .catch(() => undefined);
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('offline edits merge back when the file did not change', async ({
    browser,
    request,
    tmpPath,
    baseURL,
    waitForApplication
  }) => {
    // Edits made while disconnected must come back when the room is rebuilt
    // from a file which nobody touched meanwhile — silently, with no dialog
    // and no duplicated cells.
    //
    // A first eviction cycle settles the file first: opening a notebook
    // triggers saves (trusted metadata, kernel preferences) which would
    // otherwise be indistinguishable from an out-of-band change.
    const { page, ws, context } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication
    });
    try {
      const notebookPath = `${tmpPath}/${notebookName}`;
      await createNotebook(request, baseURL!, notebookPath);
      await openNotebook(page, notebookName);
      await typeInFirstCell(page, 'settled = 0');
      await waitForOnDisk(request, baseURL!, notebookPath, 'settled = 0');
      await page.waitForTimeout(1500);

      // Cycle 1: found a new lineage from the settled on-disk content.
      await ws.sever();
      await evictRoomAndDeleteYStore(page);
      ws.restore();
      await expect(page.locator('.jp-Cell').first()).toContainText(
        'settled = 0',
        { timeout: 15000 }
      );
      await page.waitForTimeout(2000);
      await expect(conflictDialog(page)).toHaveCount(0);
      const foundingSession = await documentSessionId(
        request,
        baseURL!,
        notebookPath
      );

      // Cycle 2: the user edits while disconnected, so the edit exists only
      // in the browser when the room is rebuilt from disk.
      await ws.sever();
      await typeInFirstCell(page, '\noffline_edit = True');
      await evictRoomAndDeleteYStore(page);
      ws.restore();

      await expect(page.locator('.jp-Cell').first()).toContainText(
        'offline_edit = True',
        { timeout: 15000 }
      );
      await page.waitForTimeout(2000);
      await expect(conflictDialog(page)).toHaveCount(0);
      await expect(page.locator('.jp-Cell')).toHaveCount(1);

      // The reconnected session persists the edit to disk, which is what
      // establishes that the client rejoined at all.
      await waitForOnDisk(
        request,
        baseURL!,
        notebookPath,
        'offline_edit = True'
      );

      // Whether the session survived this round trip is deliberately not
      // asserted: it is timing-dependent, and observed to go both ways
      // between runs. Reconnecting a notebook writes it back (trusted
      // metadata, kernel preferences, the client's own resynchronization),
      // and whether such a write lands before the eviction decides whether
      // the next rebuild replays the founding lineage or founds a new one.
      // The edit has to survive either way — merged by plain
      // synchronization, or re-applied on top — and that is what the
      // assertions above check.
      //
      // Each branch is pinned where it can be driven precisely: the roll by
      // the first test in this file, the keep by
      // `test_history_rebuilt_from_unchanged_file_keeps_the_session` in
      // tests/test_session_rebase.py.
      expect(foundingSession).toBeTruthy();
    } finally {
      await page
        .unrouteAll({ behavior: 'ignoreErrors' })
        .catch(() => undefined);
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('unsaved edits are re-applied on top of a rebuilt history', async ({
    browser,
    request,
    tmpPath,
    baseURL,
    waitForApplication
  }) => {
    // The file changed since the lineage was founded (an autosave), so the
    // rebuilt history rolls the session; but it did NOT change since the
    // client's last known save, so the client can rejoin and re-apply its
    // unsaved edits on top (semantic rebase) without any dialog.
    const { page, ws, context } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication
    });
    try {
      const notebookPath = `${tmpPath}/${notebookName}`;
      await createNotebook(request, baseURL!, notebookPath);
      await openNotebook(page, notebookName);

      await typeInFirstCell(page, 'x = 1');
      await waitForOnDisk(request, baseURL!, notebookPath, 'x = 1');
      await page.waitForTimeout(1000);
      const sessionBefore = await documentSessionId(
        request,
        baseURL!,
        notebookPath
      );

      await ws.sever();
      await typeInFirstCell(page, ' # offline');
      await evictRoomAndDeleteYStore(page);
      ws.restore();

      // Both the saved and the unsaved parts of the edit must survive.
      await expect(page.locator('.jp-Cell').first()).toContainText(
        'x = 1 # offline',
        { timeout: 20000 }
      );
      await page.waitForTimeout(2000);
      await expect(conflictDialog(page)).toHaveCount(0);
      await expect(page.locator('.jp-Cell')).toHaveCount(1);

      // The re-applied edit is autosaved through the new session. This is
      // also the first step that proves the client actually rejoined: every
      // assertion above holds on the local document alone, whether or not
      // the reconnection happened yet.
      await waitForOnDisk(request, baseURL!, notebookPath, '# offline');

      // Only now is the room's session the one the client rejoined on: the
      // saved edit had moved the lineage past its founding rebuild, so the
      // unsaved edit came back through the rebase, not a kept session.
      expect(
        await documentSessionId(request, baseURL!, notebookPath)
      ).not.toEqual(sessionBefore);
    } finally {
      await page
        .unrouteAll({ behavior: 'ignoreErrors' })
        .catch(() => undefined);
      await page.close().catch(() => undefined);
      await context.close().catch(() => undefined);
    }
  });

  test('a stale client catches up to content changed while it was away', async ({
    page,
    request,
    tmpPath,
    baseURL,
    browser,
    waitForApplication
  }) => {
    // Issue #597: a client without local edits used to be stuck on the old
    // cell content after a no-op-store restart, because the deterministic
    // rebuild of the changed file reused the Yjs coordinates the client
    // already knew. With session-based reconciliation it simply adopts the
    // new content.
    const notebookPath = `${tmpPath}/${notebookName}`;
    await createNotebook(request, baseURL!, notebookPath);
    await openNotebook(page, notebookName);
    await typeInFirstCell(page, 'version = 1');
    await waitForOnDisk(request, baseURL!, notebookPath, 'version = 1');

    // A second client opens the same notebook and then goes offline.
    const user: Partial<User.IUser> = {
      identity: {
        username: 'jovyan_2',
        name: 'jovyan_2',
        display_name: 'jovyan_2',
        initials: 'JP',
        color: 'var(--jp-collaborator-color2)'
      }
    };
    const {
      page: guestPage,
      ws: guestWs,
      context: guestContext
    } = await newInterceptedPage({
      browser,
      baseURL: baseURL!,
      tmpPath,
      waitForApplication,
      mockUser: user
    });
    try {
      await openNotebook(guestPage, notebookName);
      await expect(guestPage.locator('.jp-Cell').first()).toContainText(
        'version = 1'
      );
      await guestPage.waitForTimeout(1000);
      await guestWs.sever();

      // The first client changes the content, which is autosaved to disk.
      await typeInFirstCell(page, '\nversion = 2');
      await waitForOnDisk(request, baseURL!, notebookPath, 'version = 2');

      // All remaining clients leave, the room gets evicted, the YStore is
      // deleted: the next incarnation is rebuilt from the changed file.
      await page.notebook.close(true);
      await evictRoomAndDeleteYStore(guestPage);

      // The stale client reconnects: it has no local changes, so it adopts
      // the new content without a dialog, and without cell duplication.
      guestWs.restore();
      await expect(guestPage.locator('.jp-Cell').first()).toContainText(
        'version = 2',
        { timeout: 20000 }
      );
      await guestPage.waitForTimeout(2000);
      await expect(conflictDialog(guestPage)).toHaveCount(0);
      await expect(guestPage.locator('.jp-Cell')).toHaveCount(1);
    } finally {
      await guestPage
        .unrouteAll({ behavior: 'ignoreErrors' })
        .catch(() => undefined);
      await guestPage.close().catch(() => undefined);
      await guestContext.close().catch(() => undefined);
      await page.close();
    }
  });
});

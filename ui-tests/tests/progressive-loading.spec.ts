// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { expect, galata, test } from '@jupyterlab/galata';
import type { IJupyterLabPageFixture } from '@jupyterlab/galata';
import type * as nbformat from '@jupyterlab/nbformat';
import type { BrowserContext } from '@playwright/test';
import { rm } from 'fs/promises';

const NOTEBOOK_NAME = 'progressive_loading.ipynb';
const YSTORE_DB = '/tmp/jupyter_ystore_ui_test.db';
const YSTORE_FILES = [YSTORE_DB, `${YSTORE_DB}-shm`, `${YSTORE_DB}-wal`];
const HEAVY_PAYLOAD_BYTES = 8 * 1024 * 1024;
const HEAVY_PAYLOAD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LARGE_COLLABORATION_MESSAGE_BYTES = 512 * 1024;
const DELAYED_OUTPUT_MARKERS = [
  'delayed-output-1-ready',
  'delayed-output-2-ready',
  'delayed-output-3-ready'
];

function makeHeavyPayload(seed: number): string {
  const chunks: string[] = [];
  let state = seed;

  // Repeated text compresses too well over WebSocket to exercise the large
  // message path reliably.
  for (let i = 0; i < HEAVY_PAYLOAD_BYTES; i += 1024) {
    let chunk = '';
    for (let j = 0; j < 1024; j++) {
      state = (state * 1664525 + 1013904223) >>> 0;
      chunk += HEAVY_PAYLOAD_ALPHABET[state % HEAVY_PAYLOAD_ALPHABET.length];
    }
    chunks.push(chunk);
  }

  return chunks.join('');
}

function heavyOutput(label: string, seed: number): nbformat.IDisplayData {
  return {
    output_type: 'display_data',
    data: {
      // Keep the payload renderable but invisible in the UI.
      'text/html': `<div>${label}</div><!-- ${makeHeavyPayload(seed)} -->`
    },
    metadata: {}
  };
}

function collaborationMessageSize(message: string | Buffer): number {
  return typeof message === 'string'
    ? Buffer.byteLength(message)
    : message.byteLength;
}

const LARGE_OUTPUT_NOTEBOOK = galata.Notebook.makeNotebook([
  galata.Notebook.makeCell({
    cell_type: 'markdown',
    id: 'intro',
    source: '# Progressive loading smoke'
  }),
  galata.Notebook.makeCell({
    cell_type: 'code',
    id: 'small-output',
    source: 'print("small output")',
    outputs: [
      {
        output_type: 'stream',
        name: 'stdout',
        text: 'small-output-ready\n'
      }
    ],
    execution_count: 1
  }),
  galata.Notebook.makeCell({
    cell_type: 'code',
    id: 'heavy-output-1',
    source: 'display heavy output 1',
    outputs: [heavyOutput(DELAYED_OUTPUT_MARKERS[0], 1)],
    execution_count: 1
  }),
  galata.Notebook.makeCell({
    cell_type: 'code',
    id: 'heavy-output-2',
    source: 'display heavy output 2',
    outputs: [heavyOutput(DELAYED_OUTPUT_MARKERS[1], 2)],
    execution_count: 1
  }),
  galata.Notebook.makeCell({
    cell_type: 'code',
    id: 'heavy-output-3',
    source: 'display heavy output 3',
    outputs: [heavyOutput(DELAYED_OUTPUT_MARKERS[2], 3)],
    execution_count: 1
  })
]);

async function holdLargeCollaborationMessages(context: BrowserContext): Promise<{
  release: () => void;
  heldMessageCount: () => number;
}> {
  let released = false;
  let heldMessages = 0;
  const queuedMessages: Array<() => void> = [];

  await context.routeWebSocket(
    url => url.pathname.includes('/api/collaboration/room/'),
    ws => {
      const server = ws.connectToServer();

      ws.onMessage(message => {
        server.send(message);
      });
      server.onMessage(message => {
        const forwardMessage = () => {
          ws.send(message);
        };

        if (
          collaborationMessageSize(message) > LARGE_COLLABORATION_MESSAGE_BYTES
        ) {
          // Make the first-pass notebook state observable before outputs arrive.
          if (released) {
            forwardMessage();
          } else {
            heldMessages++;
            queuedMessages.push(forwardMessage);
          }
        } else {
          forwardMessage();
        }
      });
    }
  );

  return {
    release: () => {
      released = true;
      for (const forwardMessage of queuedMessages.splice(0)) {
        forwardMessage();
      }
    },
    heldMessageCount: () => heldMessages
  };
}

test.describe('Progressive notebook loading', () => {
  test.beforeEach(async () => {
    // The progressive path is skipped when the document is restored from ystore.
    await Promise.all(YSTORE_FILES.map(file => rm(file, { force: true })));
  });

  test.afterEach(async ({ request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${NOTEBOOK_NAME}`).catch(() => {});
  });

  test('renders notebook content before all delayed large outputs finish', async ({
    browser,
    request,
    tmpPath,
    baseURL,
    waitForApplication
  }) => {
    // Install the WebSocket route before creating the page; Galata's default
    // page fixture is already initialized by the time the test body runs.
    const context = await browser.newContext();
    const largeMessages = await holdLargeCollaborationMessages(context);
    let page: IJupyterLabPageFixture | undefined;

    try {
      page = await galata.initTestPage(
        '/lab',
        true,
        baseURL!,
        true,
        galata.DEFAULT_SETTINGS,
        true,
        true,
        await context.newPage(),
        new Map(),
        new Map(),
        tmpPath,
        waitForApplication,
        new Map(),
        true
      );

      // uploadContent creates a generic file; the progressive path needs an
      // actual notebook model.
      const response = await request.put(
        `${baseURL}/api/contents/${tmpPath}/${NOTEBOOK_NAME}`,
        {
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({
            type: 'notebook',
            format: 'json',
            content: LARGE_OUTPUT_NOTEBOOK
          })
        }
      );
      expect(response.ok()).toBeTruthy();

      await page.filebrowser.refresh();
      expect(await page.notebook.open(NOTEBOOK_NAME)).toBeTruthy();
      await expect(page.locator('.jp-Dialog:visible')).toHaveCount(0);

      const notebook = page.locator('.jp-Notebook');
      await expect(page.locator('.jp-Notebook .jp-Cell')).toHaveCount(5, {
        timeout: 15000
      });
      await expect(notebook).toContainText('small-output-ready');
      expect(await notebook.textContent()).not.toContain(
        DELAYED_OUTPUT_MARKERS[2]
      );
      await expect.poll(largeMessages.heldMessageCount).toBeGreaterThan(0);

      largeMessages.release();
      for (const marker of DELAYED_OUTPUT_MARKERS) {
        await expect(notebook).toContainText(marker, { timeout: 30000 });
      }
    } finally {
      await page?.close().catch(() => {});
      await context.close().catch(() => {});
    }
  });
});

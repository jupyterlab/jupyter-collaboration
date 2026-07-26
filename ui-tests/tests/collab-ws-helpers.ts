// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { galata } from '@jupyterlab/galata';
import type { IJupyterLabPage, IJupyterLabPageFixture } from '@jupyterlab/galata';
import type { User } from '@jupyterlab/services';
import type {
  Browser,
  BrowserContext,
  Page,
  WebSocketRoute
} from '@playwright/test';

/**
 * Deterministic control over the collaboration room websockets of a browser
 * context.
 *
 * `context.setOffline(true)` does not reliably tear down an established
 * websocket (and server-side dead-connection detection can take tens of
 * seconds), which makes eviction-based scenarios flaky. This helper proxies
 * the document room websockets (excluding the global awareness room) so a
 * test can sever them at a precise moment (the server observes a proper
 * close and can evict the room after `document_cleanup_delay`) and refuse
 * reconnection attempts until the test decides to let the client back in.
 *
 * Note: WebSocket routes only apply to pages created after the route was
 * installed, so tests must create their page through
 * {@link newInterceptedPage} rather than use the default galata `page`
 * fixture.
 */
export interface ICollabWSControl {
  /**
   * Close all live room websockets and refuse any new ones.
   */
  sever: () => Promise<void>;
  /**
   * Allow room websockets to connect again.
   */
  restore: () => void;
}

/**
 * Intercept the collaboration room websockets of a browser context.
 *
 * @param context - The browser context whose websockets to intercept.
 * @returns Controls to sever and restore the intercepted websockets.
 */
export async function interceptCollabWS(
  context: BrowserContext
): Promise<ICollabWSControl> {
  let severed = false;
  const liveRoutes = new Map<WebSocketRoute, WebSocketRoute>();

  await context.routeWebSocket(
    url =>
      url.pathname.includes('/api/collaboration/room/') &&
      !url.pathname.includes('globalAwareness'),
    ws => {
      if (severed) {
        // Refuse the connection: the client sees an abnormal closure and
        // keeps retrying with backoff until `restore()` is called.
        ws.close({ code: 4000 });
        return;
      }
      const server = ws.connectToServer();
      liveRoutes.set(ws, server);
      ws.onMessage(message => server.send(message));
      server.onMessage(message => ws.send(message));
      ws.onClose((code, reason) => {
        liveRoutes.delete(ws);
        server.close({ code, reason });
      });
      server.onClose((code, reason) => {
        liveRoutes.delete(ws);
        // Propagate the close code (e.g. 1003 with the session payload) so
        // the client-side provider sees exactly what the server sent.
        ws.close({ code, reason });
      });
    }
  );

  return {
    sever: async () => {
      severed = true;
      for (const [ws, server] of Array.from(liveRoutes)) {
        liveRoutes.delete(ws);
        // Close both legs explicitly: closing one side of the proxy does
        // not automatically close the other (`onClose` only fires for
        // closures initiated by the respective peer).
        await server.close({ code: 4000 }).catch(() => undefined);
        await ws.close({ code: 4000 }).catch(() => undefined);
      }
    },
    restore: () => {
      severed = false;
    }
  };
}

/**
 * Create a JupyterLab test page in a fresh browser context whose
 * collaboration room websockets are intercepted (see
 * {@link interceptCollabWS}).
 *
 * @param options - The page creation options.
 * @returns The page, the websocket controls and the created context.
 */
export async function newInterceptedPage(options: {
  browser: Browser;
  baseURL: string;
  tmpPath: string;
  waitForApplication: (
    page: Page,
    helpers: IJupyterLabPage
  ) => Promise<void>;
  mockUser?: boolean | Partial<User.IUser>;
  /**
   * Record a video of this context into the given directory.
   *
   * Needed because the context is created here rather than by Playwright,
   * so the `video` setting in the config does not reach it.
   */
  recordVideo?: { dir: string; size?: { width: number; height: number } };
}): Promise<{
  page: IJupyterLabPageFixture;
  ws: ICollabWSControl;
  context: BrowserContext;
}> {
  const context = await options.browser.newContext(
    options.recordVideo ? { recordVideo: options.recordVideo } : {}
  );
  const ws = await interceptCollabWS(context);
  // Proxy the REST endpoints used by the collaboration provider through the
  // Playwright (Node) network stack: after a server restart the browser may
  // keep reusing dead pooled connections (requests hang), while fresh
  // Node-side connections are reliable, mirroring how galata serves its
  // API mocks.
  for (const pattern of [
    '**/api/contents/**',
    '**/api/collaboration/session/**'
  ]) {
    await context.route(pattern, async route => {
      try {
        const response = await route.fetch();
        await route.fulfill({ response });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
  }
  const page = await galata.initTestPage(
    '/lab',
    true,
    options.baseURL,
    true,
    galata.DEFAULT_SETTINGS,
    true,
    options.mockUser ?? true,
    await context.newPage(),
    new Map(),
    new Map(),
    options.tmpPath,
    options.waitForApplication,
    new Map(),
    true
  );
  return { page, ws, context };
}

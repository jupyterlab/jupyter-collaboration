// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { execSync, spawn, ChildProcess } from 'child_process';
import { request as pwRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PORT = 8888;
const BASE = `http://localhost:${PORT}`;

// The ui-tests directory (one level up from tests/), used as the server cwd so
// that `jupyter_server_test_config.py` is found.
const SERVER_CWD = path.resolve(__dirname, '..');

/**
 * Poll the server until it is up (responds to /api/status) or down (connection
 * refused), whichever was requested.
 */
export async function waitForServer(up: boolean, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  const ctx = await pwRequest.newContext();
  try {
    while (Date.now() - start < timeoutMs) {
      try {
        const resp = await ctx.get(`${BASE}/api/status`, { timeout: 2000 });
        if (up && resp.ok()) {
          return;
        }
      } catch {
        // Connection refused / network error => server is down.
        if (!up) {
          return;
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(
      `Server did not become ${up ? 'up' : 'down'} within ${timeoutMs}ms`
    );
  } finally {
    await ctx.dispose();
  }
}

/**
 * Spawn `jupyter lab` with the integration-test config, pinning the root dir so
 * notebooks created in one server lifetime survive a restart.
 *
 * The process is detached into its own process group so the whole tree
 * (including kernels) can be killed together via {@link stopServer}.
 */
export function startServer(
  rootDir: string,
  extraArgs: string[] = []
): ChildProcess {
  // Append the server output to a log file inside the root dir, to ease
  // debugging of restart scenarios (the file survives the restarts).
  const log = fs.openSync(path.join(rootDir, 'server-log.txt'), 'a');
  return spawn(
    'jupyter',
    [
      'lab',
      '--config',
      'jupyter_server_test_config.py',
      '--no-browser',
      ...extraArgs
    ],
    {
      cwd: SERVER_CWD,
      env: { ...process.env, JUPYTERLAB_GALATA_ROOT_DIR: rootDir },
      detached: true,
      stdio: ['ignore', log, log]
    }
  );
}

/**
 * Kill whatever process holds the server port (e.g. a stray server from an
 * aborted previous run) and wait for the port to be released.
 */
export async function killPortHolder(): Promise<void> {
  try {
    execSync(`fuser -k -KILL ${PORT}/tcp`, { stdio: 'ignore' });
  } catch {
    // Nothing holds the port (or fuser is unavailable).
  }
  await waitForServer(false, 15000);
}

/**
 * Terminate the server and wait for the port to be released.
 *
 * The launcher chain (pyenv shims, `jupyter` dispatching to `jupyter-lab`)
 * can leave the server in a session of its own, out of reach of a
 * process-group kill, so the port holder is additionally terminated
 * directly via `fuser`.
 */
export async function stopServer(child: ChildProcess): Promise<void> {
  if (child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already dead.
    }
  }
  try {
    execSync(`fuser -k -TERM ${PORT}/tcp`, { stdio: 'ignore' });
  } catch {
    // Nothing holds the port (or fuser is unavailable).
  }
  try {
    await waitForServer(false, 15000);
  } catch {
    // Force kill if it did not shut down gracefully.
    if (child.pid !== undefined) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // Already dead.
      }
    }
    try {
      execSync(`fuser -k -KILL ${PORT}/tcp`, { stdio: 'ignore' });
    } catch {
      // Nothing holds the port (or fuser is unavailable).
    }
    await waitForServer(false, 15000);
  }
}

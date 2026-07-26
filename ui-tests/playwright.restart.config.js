/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * Configuration for the server-restart persistence test.
 *
 * This suite owns the Jupyter Server lifecycle itself (it kills and respawns
 * the process mid-test), so it must NOT use Playwright's managed `webServer`,
 * and it is kept out of the default suite (see `testIgnore` in
 * `playwright.config.js`).
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  workers: 1,
  // No `webServer`: the test starts/stops the server itself.
  projects: [
    {
      name: 'restart-tests',
      testMatch: 'tests/restart-*.spec.ts',
      testIgnore: '**/.ipynb_checkpoints/**',
      timeout: 180 * 1000
    }
  ],
  expect: {
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.01
    }
  }
};

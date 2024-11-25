/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * Configuration for Playwright using default from @jupyterlab/galata
 */
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

module.exports = {
  ...baseConfig,
  workers: 1,
  webServer: {
    command: 'jlpm start:timeline',
    url: 'http://localhost:8888/api/collaboration/timeline/lab',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI
  },
  expect: {
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.01
    }
  },
  projects: [
    {
      name: 'timeline-tests',
      testMatch: 'tests/**/timeline-*.spec.ts',
      testIgnore: '**/.ipynb_checkpoints/**',
      timeout: 120 * 1000
    }
  ]
};

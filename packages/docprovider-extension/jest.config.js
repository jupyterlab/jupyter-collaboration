/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

const jestJupyterLab = require('@jupyterlab/testing/lib/jest-config');

const esModules = [
  '@codemirror',
  '@microsoft',
  'exenv-es6',
  '@jupyter/ydoc',
  '@jupyter/react-components',
  '@jupyter/web-components',
  '@jupyterlab/',
  'lib0',
  'nanoid',
  'vscode-ws-jsonrpc',
  'y-protocols',
  'y-websocket',
  'yjs'
].join('|');

const baseConfig = jestJupyterLab(__dirname);

module.exports = {
  ...baseConfig,
  automock: false,
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/.ipynb_checkpoints/*'
  ],
  coverageReporters: ['lcov', 'text'],
  testRegex: 'src/.*/.*.spec.ts[x]?$',
  transformIgnorePatterns: [`/node_modules/(?!${esModules}).+`]
};

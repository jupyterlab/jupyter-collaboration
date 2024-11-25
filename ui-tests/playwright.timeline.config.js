const fs = require('fs');
const path = require('path');
const baseConfig = require('@jupyterlab/galata/lib/playwright-config');

// Directory for timeline tests
const timelineTestDir = path.resolve(
  process.env.TIMELINE_TEST_DIR || '/tmp/galata-timeline-tests'
);

// Ensure the test directory exists
if (!fs.existsSync(timelineTestDir)) {
  fs.mkdirSync(timelineTestDir, { recursive: true });
  console.log(`Created timeline test directory: ${timelineTestDir}`);
}

module.exports = {
  ...baseConfig,
  workers: 1,
  webServer: {
    command: 'jlpm start:timeline',
    url: 'http://localhost:8888/api/collaboration/timeline/lab',
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
  expect: {
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: 'timeline-tests',
      testMatch: 'tests/**/timeline-*.spec.ts',
      testIgnore: '**/.ipynb_checkpoints/**',
      retries: process.env.CI ? 2 : 0,
      timeout: 90000,
      use: {
        launchOptions: {
          slowMo: 30,
        },
        tmpPath: timelineTestDir, // Set dynamic tmpPath
      },
    },
  ],
};

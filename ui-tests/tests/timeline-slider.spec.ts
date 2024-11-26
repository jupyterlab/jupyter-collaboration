/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { expect, test } from '@jupyterlab/galata';
import { Page } from '@playwright/test';

async function capturePageErrors(page: Page) {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return pageErrors;
}

async function openNotebook(page: Page, notebookPath: string) {
  await page.click('text=File');
  await page.click('.lm-Menu-itemLabel:text("Open from Path…")');
  await page.fill(
    'input[placeholder="/path/relative/to/jlab/root"]',
    notebookPath
  );
  await page.click('.jp-Dialog-buttonLabel:text("Open")');
  await page.waitForSelector('.jp-Notebook', { state: 'visible' });
}


const isTimelineEnv = process.env.TIMELINE_FEATURE || "0";
const isTimeline = parseInt(isTimelineEnv)

test.describe('Timeline Slider', () => {

  if (isTimeline) {
    test.use({ autoGoto: false });
  }
  test('should fail if there are console errors when opening from path', async ({ page, tmpPath }) => {
    if (isTimeline) {
      console.log('Skipping this test.');
      return;
    }
    const pageErrors = await capturePageErrors(page);

    await page.notebook.createNew();
    await page.notebook.close();

    await openNotebook(page, `${tmpPath}/Untitled.ipynb`);

    expect(pageErrors).toHaveLength(0);
  });

  test('should display in status bar without console errors when baseUrl is set', async ({ page, baseURL }) => {

    if (!isTimeline) {
      console.log('Skipping this test.');
      return;
    }

    await page.goto('http://localhost:8888/api/collaboration/timeline')

    const pageErrors = await capturePageErrors(page);

    await page.notebook.createNew();

    const historyIcon = page.locator('.jp-mod-highlighted[title="Document Timeline"]');
    await expect(historyIcon).toBeVisible();

    await historyIcon.click();

    const slider = page.locator('.jp-timestampDisplay');
    await expect(slider).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  });
});

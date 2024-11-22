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

test.describe('Open from Path and Timeline Slider', () => {
  test('should fail if there are console errors', async ({ page, tmpPath }) => {
    const pageErrors = await capturePageErrors(page);

    await page.notebook.createNew();
    await page.notebook.close();

    await openNotebook(page, `${tmpPath}/Untitled.ipynb`);

    expect(pageErrors).toHaveLength(0);
  });
/*
  test('should display timeline slider without console errors', async ({ page, baseURL }) => {
    expect(baseURL).toContain('/api/collaboration'); 

    const pageErrors = await capturePageErrors(page);

    await page.notebook.createNew();

    const historyIcon = page.locator('.jp-TimelineSlider-icon');
    await expect(historyIcon).toBeVisible();

    await historyIcon.click();

    const slider = page.locator('.jp-TimelineSlider');
    await expect(slider).toBeVisible();

    expect(pageErrors).toHaveLength(0);
  }); */
});

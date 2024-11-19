/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { expect, test } from '@jupyterlab/galata';
import { Page } from '@playwright/test';

test.describe('Timeline Slider', () => {

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

  test('should fail if there are console errors', async ({ page, tmpPath }) => {
    const pageErrors = await capturePageErrors(page);

    await page.notebook.createNew();
    await page.notebook.save();
    await page.notebook.close();

    await openNotebook(page, `${tmpPath}/Untitled.ipynb`);

    expect(pageErrors).toHaveLength(0);
  });
});

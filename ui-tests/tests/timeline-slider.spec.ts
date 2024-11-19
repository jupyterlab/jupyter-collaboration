/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { expect, test } from '@jupyterlab/galata';

test.describe('Timeline Slider', () => {
  test('should not show errors when opening file from path', async ({ page,  tmpPath }) => {
    await page.notebook.createNew();
    await page.notebook.save();
    await page.notebook.close();

    // Step 1: Click on the "File" menu
    await page.click('text=File');
    await page.waitForSelector('.lm-Menu-itemLabel:text("Open from Path…")', { state: 'visible' });

    // Step 2: Select "Open from Path..."
    await page.click('.lm-Menu-itemLabel:text("Open from Path…")');

    // Step 3: Enter the path for the notebook
    await page.waitForSelector('input[placeholder="/path/relative/to/jlab/root"]'); 
    await page.fill('input[placeholder="/path/relative/to/jlab/root"]', `${tmpPath}/Untitled.ipynb`);
    await page.click('.jp-Dialog-buttonLabel:text("Open")'); 

    await page.waitForSelector('.jp-Notebook', { state: 'visible' }); 


    // Step 6: Assert that no error is thrown
    const consoleMessages: any[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleMessages.push(msg.text());
      }
    });
    await page.waitForTimeout(1000);

    // Ensure there are no errors in the console
    expect(consoleMessages).toHaveLength(0);

  });
});

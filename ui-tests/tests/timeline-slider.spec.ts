/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { expect, test } from '@jupyterlab/galata';

test.describe('Timeline Slider', () => {
  test('should open a notebook and interact with the timeline slider', async ({ page,  tmpPath }) => {
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

    // Step 4: Wait for the notebook to load
    await page.waitForSelector('.jp-Notebook', { state: 'visible' }); 

    // Step 5: Click the history icon in the status bar
    const historyIcon = page.locator('#jp-slider-status-bar');
    await expect(historyIcon).toBeVisible(); 
    await historyIcon.click(); 

    // Step 6: Assert that no error is thrown
    const consoleMessages: any[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleMessages.push(msg.text());
      }
    });

    // Give some time for potential errors to appear
    await page.waitForTimeout(1000);

    // Ensure there are no errors in the console
    expect(consoleMessages).toHaveLength(0);

    // Clean up by closing the notebook
    await page.click('text=File');
    await page.click('text=Close All Tabs');
  });
});

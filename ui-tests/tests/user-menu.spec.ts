/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { IJupyterLabPageFixture, expect, test } from '@jupyterlab/galata';
import type { Locator } from '@playwright/test';

test.use( {
  permissions: ['clipboard-read']
});

const openDialog = async (page: IJupyterLabPageFixture): Promise<Locator> => {
  const sharedLinkButton = page.locator('jp-button[data-command="collaboration:shared-link"]');
  await sharedLinkButton.click();
  await expect(page.locator('.jp-Dialog')).toBeVisible();
  return page.locator('.jp-Dialog').first();
};

test('the top bar should contain one user menu and one share button', async ({ page }) => {
  const shareButton = page.locator('#jp-top-bar jp-button[data-command="collaboration:shared-link"]');
  await expect(shareButton).toHaveCount(1);
  const userMenu = page.locator('#jp-top-bar .jp-MenuBar-anonymousIcon');
  await expect(userMenu).toHaveCount(1);
});

test('should open dialog when clicking on the shared link button', async ({ page }) => {
  const sharedLinkButton = page.locator('jp-button[data-command="collaboration:shared-link"]');

  expect(await sharedLinkButton.screenshot()).toMatchSnapshot(
    'shared-link-icon.png'
  );

  await sharedLinkButton.click();
  await expect(page.locator('.jp-Dialog')).toBeVisible();

  expect(await page.locator('.jp-Dialog > div ').screenshot()).toMatchSnapshot(
    'shared-link-dialog.png'
  );
});

test('should close the shared link dialog on cancel', async ({ page }) => {
  const dialog = await openDialog(page);

  await dialog.locator('.jp-mod-reject').click();
  await expect(dialog).not.toBeVisible();
});

test('should copy the shared link in clipboard', async ({ page }) => {
  const dialog = await openDialog(page);

  // copy the link
  await dialog.locator('.jp-mod-accept').click();
  await expect(dialog).not.toBeVisible();

  let clipboardText1 = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText1).toBe('http://localhost:8888/lab/tree/RTC%3Atests-user-menu-should-copy-the-shared-link-in-clipboard');
});

test('should copy the shared link with filepath', async ({ page }) => {

  await page.notebook.createNew();
  const dialog = await openDialog(page);

  // copy the link
  await dialog.locator('.jp-mod-accept').click();
  await expect(dialog).not.toBeVisible();

  let clipboardText1 = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText1).toBe('http://localhost:8888/lab/tree/RTC%3Atests-user-menu-should-copy-the-shared-link-with-filepath/Untitled.ipynb');
});


/* TODO: Add test using token in URL, probably using playwright projects */

// test('should copy the shared link in clipboard with token', async ({ page }) => {
//   const dialog = await openDialog(page);

//   // click the token checkbox
//   await dialog.locator('input[type="checkbox"]').click();
//   expect(await page.locator('.jp-Dialog').screenshot()).toMatchSnapshot(
//     'shared-link-dialog-token.png'
//   );

//   //copy the link with token
//   await dialog.locator('.jp-mod-accept').click();
//   await expect(dialog).not.toBeVisible();

//   let clipboardText1 = await page.evaluate(() => navigator.clipboard.readText());
//   expect(clipboardText1).toBe('http://localhost:8888/lab/tree/RTC%3Atests-user-menu-should-copy-the-shared-link-in-clipboard');
// });

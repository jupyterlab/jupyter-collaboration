/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { expect, test } from '@jupyterlab/galata';

test.use( {
  permissions: ['clipboard-read']
});

test('should open JupyterHub sharing dialog', async ({ page }) => {
  // Mock PageConfig
  page.evaluate(() => {
    document.body.dataset['hubUser'] = 'jovyan';
    document.body.dataset['hubServerUser'] = 'jovyan';
    document.body.dataset['hubServerName'] = 'my-server';
    document.body.dataset['hubHost'] = '';
    document.body.dataset['hubPrefix'] = '/hub/';
  });

  // Mock JupyterHub requests
  await page.route('/hub/api', (route) => {
    return route.fulfill({
      status: 200,
      body: JSON.stringify({version: '5.0.0'}),
      contentType: 'application/json'
    });
  });
  await page.route('/hub/api/user', (route) => {
    return route.fulfill({
      status: 200,
      body: JSON.stringify({
        scopes: ['read:users:name', 'shares!user', 'list:users', 'list:groups']
      }),
      contentType: 'application/json'
    });
  });
  await page.route(/\/hub\/api\/users.*/, (route) => {
    return route.fulfill({
      status: 200,
      body: JSON.stringify([
        {
          name: 'test-user-1',
          kind: 'user'
        },
        {
          name: 'test-user-2',
          kind: 'user'
        }
      ]),
      contentType: 'application/json'
    });
  });
  await page.route('/hub/api/groups', (route) => {
    return route.fulfill({
      status: 200,
      body: JSON.stringify([
        {
          name: 'test-group-1',
          kind: 'group'
        },
        {
          name: 'test-group-2',
          kind: 'group'
        }
      ]),
      contentType: 'application/json'
    });
  });
  await page.route('/hub/api/shares/jovyan/my-server', (route) => {
    return route.fulfill({
      status: 200,
      body: JSON.stringify({
        items: [
        {
          created_at: '2025-05-01',
          user: {
            name: "test-user-1"
          }
        }
      ]}),
      contentType: 'application/json'
    });
  });

  const sharedLinkButton = page.locator('jp-button[data-command="collaboration:shared-link"]');
  await sharedLinkButton.click();
  const dialog = page.locator('.jp-Dialog').first();
  await expect(dialog).toBeVisible();

  // Wait for user results to load.
  await page.waitForSelector('.jp-ManageSharesBody-user-item');

  expect(await dialog.locator('.jp-Dialog-content').screenshot()).toMatchSnapshot(
    'shared-link-dialog-hub.png'
  );

  // Copy the link
  await dialog.locator('.jp-mod-accept').click();
  await expect(dialog).not.toBeVisible();

  let clipboardText = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboardText).toBe('http://localhost:8888/lab/tree/tests-hub-share-should-open-JupyterHub-sharing-dialog');
});

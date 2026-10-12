/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import {
  expect,
  galata,
  IJupyterLabPageFixture,
  test
} from '@jupyterlab/galata';
import type { User } from '@jupyterlab/services';

const pathUntitled = 'Untitled.ipynb';

test.describe('Collaborator flag', () => {
  let guestPage: IJupyterLabPageFixture;

  test.beforeEach(
    async ({ baseURL, browser, tmpPath, waitForApplication }) => {
      const user: Partial<User.IUser> = {
        identity: {
          username: 'jovyan_2',
          name: 'jovyan_2',
          display_name: 'jovyan_2',
          initials: 'JP',
          color: 'var(--jp-collaborator-color2)'
        }
      };
      const { page: newPage } = await galata.newPage({
        baseURL: baseURL!,
        browser,
        mockUser: user,
        tmpPath,
        waitForApplication
      });
      guestPage = newPage;

      await guestPage.evaluate(() => {
        window.galataip.on('dialog', d => {
          d?.resolve();
        });
      });
    }
  );

  test.afterEach(async ({ page, request, tmpPath }) => {
    await guestPage.close();
    await page.close();
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${pathUntitled}`);
  });

  test('should show the collaborator pill above a remote cursor', async ({
    page
  }) => {
    await page.notebook.createNew();
    await page.notebook.activate(pathUntitled);

    await guestPage.filebrowser.refresh();
    await guestPage.notebook.open(pathUntitled);
    await guestPage.notebook.activate(pathUntitled);

    await guestPage.notebook.enterCellEditingMode(0);
    await guestPage.keyboard.type('print("hello")');

    const remoteCursor = page.locator('.jp-remote-cursor.jp-mod-primary');
    await expect(remoteCursor).toBeVisible();

    // The flag fades once the collaborator goes idle; hovering the cursor
    // brings it back, which avoids racing the fade timer.
    await expect(page.locator('.jp-remote-userFlag')).toHaveClass(
      /jp-mod-idle/
    );

    const box = (await remoteCursor.boundingBox())!;
    await page.mouse.move(box.x - 4, box.y + box.height / 2);
    await page.mouse.move(box.x, box.y + box.height / 2);

    const pill = page.locator('.jp-remote-userFlag:not(.jp-mod-idle)');
    await expect(pill).toBeVisible();

    expect(
      await pill.screenshot({ animations: 'disabled' })
    ).toMatchSnapshot('collaborator-pill.png');
  });
});

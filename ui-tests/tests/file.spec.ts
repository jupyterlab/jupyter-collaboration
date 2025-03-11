// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  expect,
  galata,
  IJupyterLabPageFixture,
  test
} from '@jupyterlab/galata';
import type { User } from '@jupyterlab/services';

test.describe('File Editing', () => {
  const exampleFile = 'example.py';
  let guestPage: IJupyterLabPageFixture;

  test.beforeEach(
    async ({
      page,
      request,
      baseURL,
      browser,
      tmpPath,
      waitForApplication
    }) => {
      // Create a new client
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
        // Acknowledge any dialog
        window.galataip.on('dialog', d => {
          d?.resolve();
        });
      });
    }
  );

  test.afterEach(async ({ page, request, tmpPath }) => {
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/${exampleFile}`);
    // Make sure to close the page to remove the client
    // from the awareness
    await guestPage.close();
    await page.close();
  });

  [
    { type: "normal", content: '# Example file\n# With normal/linux line endings\n\nname = ""\n\nprint(f"Hello {name}")' },
    { type: "dos", content: '# Example file\r\n# With DOS (carriage return) line endings\r\n\r\nname = ""\r\n\r\nprint(f"Hello {name}")' },
  ].forEach(({ type, content }) => {
    test(`Edit a ${type} file`, async ({ page, request, tmpPath }) => {
      const contents = galata.newContentsHelper(request);
      await expect(contents.uploadContent(
        content,
        "text",
        `${tmpPath}/${exampleFile}`
      )).toBeTruthy();

      await page.filebrowser.open(exampleFile);
      const editor = page.locator('.cm-editor > .cm-scroller', { hasText: "Example" })
      const tab = page.locator(`//li[contains(@title,"${exampleFile}") and @role="tab"]`)

      // Enter text at `name = ""` to make `name = "Kuba"`
      await editor.click();
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowUp");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.type("Kuba");

      // Ensure we save the file
      // Due to the current "feature" of collab that it forces auto-save, we should not need to sent Ctrl+S but added so this doesn't break in future
      console.log(await tab.getAttribute("class"));
      await expect(tab).toHaveClass(/jp-mod-dirty/);
      await page.keyboard.press("Control+S");
      await expect(tab).not.toHaveClass(/jp-mod-dirty/);

      // This test should never fail, it's just testing that the above name insert completed succesfully
      await expect(page.locator('.cm-editor > .cm-scroller', { hasText: "Example" })).toContainText('name = "Kuba"');

      // Close and re-open the file
      await page.locator(`div[title="Close ${exampleFile}"]`).click();
      await page.filebrowser.open(exampleFile);

      // The file should have saved successfully
      await expect(page.locator('.cm-editor > .cm-scroller', { hasText: "Example" })).toContainText('name = "Kuba"');
    });
  });
});

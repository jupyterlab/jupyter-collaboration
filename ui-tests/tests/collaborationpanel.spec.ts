/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { expect, IJupyterLabPageFixture, galata, test } from '@jupyterlab/galata';
import type { User } from '@jupyterlab/services';
import type { Locator, Page } from '@playwright/test';

const openPanel = async (page: Page): Promise<Locator> => {
  const panel = await page.$('.jp-SidePanel.jp-RTCPanel');

  if (!(await panel?.isVisible())) {
    const collaborationIcon = page.locator('.jp-SideBar.jp-mod-left ul li[title="Collaboration"]');
    await collaborationIcon.click();
    await expect(page.locator('.jp-SidePanel.jp-RTCPanel')).toBeVisible();
  }
  return page.locator('.jp-SidePanel.jp-RTCPanel').first();
};

test('should contain the collaboration panel icon', async ({ page }) => {
  const collaborationIcon = page.locator('.jp-SideBar.jp-mod-left ul li[title="Collaboration"]');
  expect(collaborationIcon).toHaveCount(1);
  expect(await collaborationIcon.screenshot()).toMatchSnapshot(
    'collaboration_icon.png'
  );
});

test('collaboration panel should contains two items', async ({ page }) => {
  const panel = await openPanel(page);
  const accordionTitles = panel.locator('.lm-AccordionPanel>h3');
  expect(accordionTitles).toHaveCount(2);

  // Collapses the accordion items.
  for (let index = 0; index < await accordionTitles.count(); index++) {
    const classList = await accordionTitles.nth(index).getAttribute('class') || '';
    if (classList.includes('lm-mod-expanded')) {
      await accordionTitles.nth(index).click();
    }
  }
  expect(await panel.screenshot()).toMatchSnapshot(
    'collaborationPanelCollapsed.png'
  );

  // Opens the collaborators list and expect it empty.
  await accordionTitles.last().click();
  expect(panel.locator('.jp-CollaboratorsList .jp-Collaborator')).toHaveCount(0);
});


test.describe('One client', () => {
  let guestPage: IJupyterLabPageFixture;

  test.beforeEach(
    async ({ baseURL, browser, page, tmpPath, waitForApplication }) => {
      const user2: Partial<User.IUser> = {
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
        mockUser: user2,
        tmpPath,
        waitForApplication
      });
      await newPage.evaluate(() => {
        // Acknowledge any dialog
        window.galataip.on('dialog', d => {
          d?.resolve();
        });
      });
      guestPage = newPage;
    }
  );

  test.afterEach(async ({ page }) => {
    // Make sure to close the page to remove the client
    // from the awareness
    await guestPage.close();
    await page.close();
  });

  test('collaborators list should be updated', async ({ page, browser }) => {
    const panel = await openPanel(page);

    // Expect the collaborators list to contain 1 element.
    await expect(panel.locator('.jp-CollaboratorsList .jp-Collaborator')).toHaveCount(1);

    // Log out the collaborator and expect the collaborators list to be empty.
    await guestPage.click('.lm-MenuBar-itemLabel:text("File")');
    await guestPage.click('.lm-Menu-itemLabel:text("Log Out")');
    await guestPage.close();
    await expect(panel.locator('collaboratorsList .jp-Collaborator')).toHaveCount(0);
  });

  test('clicking on collaborator should open to its current document', async ({ page, browser }) => {
    // Expand the collaborators list in there.
    const panel = await openPanel(guestPage);
    const accordionTitles = panel.locator('.lm-AccordionPanel>h3');
    if (
      !(await accordionTitles.last().getAttribute('class') || '')
        .includes('lm-mod-expanded')
    ) {
      await accordionTitles.last().click();
    }

    await openPanel(page);

    // Expect the collaborators list to contain one collaborator.
    await expect.soft(panel.locator('.jp-CollaboratorsList .jp-Collaborator')).toHaveCount(1);

    const notebookName = await page.notebook.createNew() || '';

    // First expect the new page only contains the Launcher tab.
    const dockTabs = guestPage.locator('#jp-main-dock-panel > .lm-DockPanel-tabBar > ul');
    await expect.soft(dockTabs.locator('li')).toHaveCount(1);
    await expect.soft(dockTabs.locator('li.lm-mod-current > .lm-TabBar-tabLabel')).toHaveText('Launcher');

    // Click on collaborator should open the current notebook of this collaborator.
    await panel.locator('.jp-CollaboratorsList .jp-Collaborator').first().click();
    await expect.soft(dockTabs.locator('li')).toHaveCount(2);
    await expect(dockTabs.locator('li.lm-mod-current > .lm-TabBar-tabLabel')).toHaveText(notebookName);
  });
});

test.describe('Three clients', () => {
  let numClients = 3;
  let guestPages: Array<IJupyterLabPageFixture> = [];

  test.beforeEach(
    async ({ baseURL, browser, page, tmpPath, waitForApplication }) => {
      for (let i = 0; i < numClients; i++) {
        // Create a new client
        const user: Partial<User.IUser> = {
          identity: {
            username: 'jovyan_' + i,
            name: 'jovyan_' + i,
            display_name: 'jovyan_' + i,
            initials: 'JP',
            color: `var(--jp-collaborator-color${i + 1})`
          }
        };
        const { page: newPage } = await galata.newPage({
          baseURL: baseURL!,
          browser,
          mockUser: user,
          tmpPath,
          waitForApplication
        });

        await newPage.evaluate(() => {
          // Acknowledge any dialog
          window.galataip.on('dialog', d => {
            d?.resolve();
          });
        });
        guestPages.push(newPage);
      }
    }
  );

  test.afterEach(async ({ page }) => {
    // Make sure to close the page to remove the client
    // from the awareness
    for (let i = 0; i < numClients; i++) {
      await guestPages[i].close();
    }
    guestPages = [];
    await page.close();
  });

  test('Without document', async ({ page }) => {
    await page.sidebar.openTab('jp-collaboration-panel');

    // wait for guest clients
    for (let i = 0; i < numClients; i++) {
      await page.waitForSelector(`text=jovyan_${i}`);
    }

    const tab = await page.sidebar.getContentPanel('left');
    expect(await tab?.screenshot()).toMatchSnapshot(
      'three-client-without-document.png'
    );
  });

  test('With document', async ({ page, request, tmpPath }) => {
    // Renaming does not work
    await page.notebook.createNew();
    await page.notebook.open('Untitled.ipynb');

    await Promise.all(
      guestPages.map(async p => {
        await p.filebrowser.refresh();
        await p.notebook.open('Untitled.ipynb');
      })
    );

    await page.sidebar.openTab('jp-collaboration-panel');

    await page.notebook.activate('Untitled.ipynb');
    for (let i = 0; i < numClients; i++) {
      await guestPages[i].notebook.activate('Untitled.ipynb');
    }

    // wait for guest clients
    for (let i = 0; i < numClients; i++) {
      await page.waitForSelector('text=/jovyan_. . Untitled.ipynb/');
    }

    const tab = await page.sidebar.getContentPanel('left');
    expect(await tab?.screenshot()).toMatchSnapshot(
      'three-client-with-document.png'
    );

    await page.notebook.close(true);
    for (let i = 0; i < numClients; i++) {
      await guestPages[i].notebook.close(true);
    }
    const contents = galata.newContentsHelper(request);
    await contents.deleteFile(`${tmpPath}/Untitled.ipynb`);
  });
});

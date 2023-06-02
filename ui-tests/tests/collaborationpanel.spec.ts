/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { IJupyterLabPageFixture, expect, test, galata } from '@jupyterlab/galata';
import { Locator } from '@playwright/test';

const openPanel = async (page: IJupyterLabPageFixture): Promise<Locator> => {
  const collaborationIcon = page.locator('.jp-SideBar.jp-mod-left ul li[title="Collaboration"]');
  await collaborationIcon.click();
  await expect(page.locator('.jp-SidePanel.jp-RTCPanel')).toBeVisible();
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
  for (let index = 0; index < await accordionTitles.count(); index ++) {
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
  expect(panel.locator('.jp-CollaboratorsList').first().locator('jp-Collaborator')).toHaveCount(0);
});

test('collaborators list should be updated', async ({ page, browser }) => {
  page.on('console', msg => console.log(msg.text()))
  const panel = await openPanel(page);
  const accordionTitles = panel.locator('.lm-AccordionPanel>h3');

  // Expands the collaborators list.
  if (
    !(await accordionTitles.last().getAttribute('class') || '')
    .includes('lm-mod-expanded')
  ) {
    await accordionTitles.last().click();
  }

  // Expect the collaborators list to be empty.
  const collaboratorsList = panel.locator('.jp-CollaboratorsList').first();
  await expect(collaboratorsList.locator('.jp-Collaborator')).toHaveCount(0);

  // Open a new page and expect the collaborators list to contain 1 element.
  const newContext = await browser.newContext();
  const newPage = await browser.newPage();
  await newPage.goto(page.url());
  await expect(collaboratorsList.locator('.jp-Collaborator')).toHaveCount(1);

  // Log out the collaborator and expect the collaborators list to be empty.
  await newPage.click('.lm-MenuBar-itemLabel:text("File")');
  await newPage.click('.lm-Menu-itemLabel:text("Log Out")');
  await newPage.close();
  await newContext.close();
  await expect(collaboratorsList.locator('.jp-Collaborator')).toHaveCount(0);
});

/*
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */

import { expect, IJupyterLabPageFixture, test } from '@jupyterlab/galata';
import type { User } from '@jupyterlab/services';
import type { Locator } from '@playwright/test';

const openPanel = async (page: IJupyterLabPageFixture): Promise<Locator> => {
  const panel = page.locator('.jp-SidePanel.jp-collab-chat-sidepanel');

  if (!(await panel?.isVisible())) {
    const chatIcon = page.getByTitle('Jupyter Chat');
    await chatIcon.click();
    await expect(panel).toBeVisible();
  }
  return panel.first();
};

test.describe('Initialization', () => {
  test('should contain the chat panel icon', async ({ page }) => {
    const chatIcon = page.getByTitle('Jupyter Chat');
    expect(chatIcon).toHaveCount(1);
    expect(await chatIcon.screenshot()).toMatchSnapshot(
      'chat_icon.png'
    );
  });

  test('chat panel should contain a toolbar', async ({ page }) => {
    const panel = await openPanel(page);
    const toolbar = panel.locator('.jp-SidePanel-toolbar');
    await expect(toolbar).toHaveCount(1);

    const items = toolbar.locator('.jp-Toolbar-item');
    await expect(items).toHaveCount(2);
    await expect(items.first()).toHaveClass(/.jp-collab-chat-add/);
    await expect(items.last()).toHaveClass(/.jp-collab-chat-open/);
  });

  test('chat panel should not contain a chat at init', async ({ page }) => {
    const panel = await openPanel(page);
    const content = panel.locator('.jp-SidePanel-content');
    await expect(content).toBeEmpty();
  });
})

test.describe('Chat creation', () => {
  let panel: Locator;
  let dialog: Locator;

  test.beforeEach(async ({ page }) => {
    panel = await openPanel(page);
    const addButton = panel.locator(
      '.jp-SidePanel-toolbar .jp-Toolbar-item.jp-collab-chat-add'
    );
    await addButton.click();

    dialog = page.locator('.jp-Dialog');
    await dialog.waitFor();
  });

  test('should create a chat', async ({ page }) => {
    await dialog.locator('input[type="text"]').type('chat-test');
    await dialog.getByRole('button').getByText('Ok').click();
    expect(await page.filebrowser.contents.fileExists('chat-test.chat')).toBeTruthy();

    const chatTitle = panel.locator('.jp-SidePanel-content .jp-AccordionPanel-title');
    await expect(chatTitle).toHaveCount(1);
    await expect(chatTitle.locator('.lm-AccordionPanel-titleLabel')).toHaveText(
      'chat-test'
    );
  });

  test('should create an untitled file if no name is provided', async ({ page }) => {
    await dialog.getByRole('button').getByText('Ok').click();
    expect(await page.filebrowser.contents.fileExists('untitled.chat')).toBeTruthy();

    const chatTitle = panel.locator('.jp-SidePanel-content .jp-AccordionPanel-title');
    await expect(chatTitle).toHaveCount(1);
    await expect(chatTitle.locator('.lm-AccordionPanel-titleLabel')).toHaveText(
      'untitled'
    );
  });

  test('should not create a chat if dialog is cancelled', async ({ page }) => {
    await dialog.getByRole('button').getByText('Cancel').click();

    const content = panel.locator('.jp-SidePanel-content');
    await expect(content).toBeEmpty();
  });
})

test.describe('Opening/closing chat', () => {
  const name = 'my-chat';
  let panel: Locator;
  let select: Locator;

  test.beforeEach(async ({ page }) => {
    await page.filebrowser.contents.uploadContent('{}', 'text', `${name}.chat`);
  });

  test.afterEach(async ({ page }) => {
    await page.filebrowser.contents.deleteFile( `${name}.chat`);
  });

  test('should list existing chat', async ({ page }) => {
    // reload to update the chat list
    // FIX: add listener on file creation
    await page.reload();
    panel = await openPanel(page);
    select = panel.locator(
      '.jp-SidePanel-toolbar .jp-Toolbar-item.jp-collab-chat-open select'
    );

    for (let i=0; i< await select.locator('option').count(); i++) {
      console.log(await select.locator('option').nth(i).textContent());
    }
    await expect(select.locator('option')).toHaveCount(2);
    await expect(select.locator('option').last()).toHaveText(name);
  });

  test('should open an existing chat and close it', async ({ page }) => {
    // reload to update the chat list
    // FIX: add listener on file creation
    await page.reload();
    panel = await openPanel(page);
    select = panel.locator(
      '.jp-SidePanel-toolbar .jp-Toolbar-item.jp-collab-chat-open select'
    );

    await select.selectOption(name);

    const chatTitle = panel.locator('.jp-SidePanel-content .jp-AccordionPanel-title');
    await expect(chatTitle).toHaveCount(1);
    await expect(chatTitle.locator('.lm-AccordionPanel-titleLabel')).toHaveText(
      name
    );

    await page.pause();
    await chatTitle.getByRole('button').click();
    await page.pause();
    await expect(chatTitle).toHaveCount(0);
  });
});

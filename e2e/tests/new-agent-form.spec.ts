/**
 * E2E: the New-agent form works inside the VS Code webview.
 *
 * Assertions:
 *   1. Hovering + Agent shows "New agent…"; clicking opens the form.
 *   2. Spawning with a Name + explicit folder invokes mock claude and the
 *      custom name renders in the webview (customTitle via shared dispatch).
 *   3. The explicit folder is recorded in config.json recents (MRU).
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { launchVSCode, waitForWorkbench } from '../helpers/launch';
import { getPixelAgentsFrame, openPixelAgentsPanel } from '../helpers/webview';

test('New-agent form spawns a named agent in a chosen folder (VS Code)', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, tmpHome, workspaceDir, mockLogFile } = session;

  test.setTimeout(120_000);

  try {
    await waitForWorkbench(window);
    await openPixelAgentsPanel(window);
    const frame = await getPixelAgentsFrame(window);

    // 1. Open the form from the + Agent hover menu
    await frame.getByRole('button', { name: '+ Agent' }).hover();
    await frame.getByText('New agent…').click();
    await expect(frame.getByRole('dialog', { name: 'New agent' })).toBeVisible();

    // 2. Name + explicit folder, spawn
    await frame.getByLabel('Agent name').fill('Golden Retriever');
    await frame.getByLabel('Starting folder').fill(workspaceDir);
    await frame.getByRole('button', { name: 'Spawn' }).click();

    // Mock claude invoked...
    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(mockLogFile, 'utf8').trim().length > 0;
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    // ...and the custom name renders in the webview (rail/panel label)
    await expect(frame.getByText('Golden Retriever').first()).toBeVisible({ timeout: 15_000 });

    // 3. Recents recorded in the isolated config.json
    const configPath = path.join(tmpHome, '.pixel-agents', 'config.json');
    await expect
      .poll(
        () => {
          try {
            const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Record<string, unknown>;
            return cfg['pixel-agents.recentAgentFolders'];
          } catch {
            return undefined;
          }
        },
        { timeout: 10_000 },
      )
      .toEqual([workspaceDir]);

    await testInfo.attach('vscode-new-agent-form', {
      body: await window.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    await session.cleanup();
  }
});

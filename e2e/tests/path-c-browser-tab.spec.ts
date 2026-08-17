/**
 * E2E (QA "Path C"): a browser tab connects to the EXTENSION-owned server and
 * both runtimes stay in sync through the shared orchestrator + uiDispatch.
 *
 * Assertions:
 *   1. The extension-owned server serves the SPA (title "Pixel Agents").
 *   2. An agent created in VS Code appears in the browser via snapshot replay.
 *   3. + Agent clicked IN THE BROWSER creates an agent that appears in the
 *      VS Code webview (inbound WS dispatch + broadcast bridging).
 */
import { test, expect, chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

import { launchVSCode, waitForWorkbench } from '../helpers/launch';
import { clickAddAgent, getPixelAgentsFrame, openPixelAgentsPanel } from '../helpers/webview';

test('browser tab on the extension-owned server syncs both directions', async ({}, testInfo) => {
  const session = await launchVSCode(testInfo.title);
  const { window, tmpHome } = session;

  test.setTimeout(180_000);

  const browser = await chromium.launch();
  try {
    // 1. VS Code side: workbench + panel + one agent
    await waitForWorkbench(window);
    await openPixelAgentsPanel(window);
    const frame = await getPixelAgentsFrame(window);
    await clickAddAgent(frame);
    await expect(frame.getByText(/Claude Code #1/).first()).toBeVisible({ timeout: 15_000 });

    // 2. Discover the extension-owned server from the ISOLATED home
    const serverJsonPath = path.join(tmpHome, '.pixel-agents', 'server.json');
    await expect.poll(() => fs.existsSync(serverJsonPath), { timeout: 15_000 }).toBe(true);
    const serverCfg = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8')) as { port: number };

    // 3. Browser tab connects; replay delivers the VS Code-created agent
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${serverCfg.port}/`);
    await expect(page).toHaveTitle('Pixel Agents');
    await expect(page.getByText(/Claude Code #1/).first()).toBeVisible({ timeout: 15_000 });

    // 4. Browser → + Agent → agent #2 appears in the VS CODE webview
    await page.getByRole('button', { name: '+ Agent' }).click();
    await expect(frame.getByText(/Claude Code #2/).first()).toBeVisible({ timeout: 20_000 });
    // ...and in the browser itself via the bridged broadcast
    await expect(page.getByText(/Claude Code #2/).first()).toBeVisible({ timeout: 10_000 });

    await testInfo.attach('browser-tab-screenshot', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await testInfo.attach('vscode-screenshot', {
      body: await window.screenshot(),
      contentType: 'image/png',
    });
  } finally {
    await browser.close();
    await session.cleanup();
  }
});

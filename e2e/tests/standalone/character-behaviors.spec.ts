import fs from 'node:fs';

import { expect, test } from '../../fixtures/standalone';
import { arrangeNextClaudeInvocation, claudeScenario } from '../../helpers/mock-claude';
import {
  expectOverlayCount,
  getAgentOverlays,
  readAgentOverlayIds,
  selectCharacter,
} from '../../helpers/office';
import { setSettings } from '../../helpers/webview';

// A pty spawn goes shell -l -c → mock claude → invocation log; give the whole
// chain (plus xterm mount + scrollback replay) generous slack — mirrors
// terminal.spec.ts's SPAWN_TIMEOUT_MS. Crash assertions reuse the same budget:
// pty exit → agentCrashed broadcast → render can take seconds on a slow runner.
const SPAWN_TIMEOUT_MS = 20_000;

/** Open the New-agent form and submit it with whatever fields are filled. */
async function spawnFromForm(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: '+ Agent' }).click();
  await expect(page.getByRole('dialog', { name: 'New agent' })).toBeVisible();
  await page.getByRole('button', { name: 'Spawn' }).click();
}

interface CrashHookCharacter {
  id: number;
  crashed: boolean;
  crashedAcknowledged: boolean;
}

/** Read the crash fields testHooks.getCharacters() exposes — crashed sprites
 *  render only on the canvas, so this is the only observable for `crashed` /
 *  `crashedAcknowledged` (same rationale as every other getCharacters() read
 *  in the suite). */
async function getCrashedCharacters(
  page: import('@playwright/test').Page,
): Promise<CrashHookCharacter[]> {
  return page.evaluate(() => {
    const hooks = (
      window as {
        __pixelAgentsTestHooks?: {
          getCharacters?: () => Array<{
            id: number;
            crashed: boolean;
            crashedAcknowledged: boolean;
          }>;
        };
      }
    ).__pixelAgentsTestHooks;
    return hooks?.getCharacters?.() ?? [];
  });
}

test.describe('Standalone / Character behaviors', () => {
  test('unnamed spawn shows its terminal name in the rail and overlay @area:standalone', async ({
    page,
    standalone,
  }) => {
    // Overlays only render for hovered/selected agents unless labels are on.
    await setSettings(page, { alwaysShowLabels: true });
    await spawnFromForm(page);

    // Rail tab: no name was given, so the default "Claude Code #N" terminal
    // name is what shows.
    await expect(page.getByTestId('terminal-band')).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });
    const tab = page.getByRole('tab', { name: /Claude Code #\d+/ });
    await expect(tab).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });
    const tabLabel = (await tab.locator('span').first().textContent())?.trim() ?? '';
    expect(tabLabel).toMatch(/^Claude Code #\d+$/);

    // The MOCK claude answered the spawn — not a real CLI, same proof
    // terminal.spec.ts's first test uses.
    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(standalone.mockLogFile, 'utf8');
          } catch {
            return '';
          }
        },
        { timeout: SPAWN_TIMEOUT_MS, message: 'mock claude should log the spawn invocation' },
      )
      .toContain('session-id=');

    // Character overlay name row shows the SAME string — select the
    // character first (selection is independent of the overlay rendering
    // gate here since alwaysShowLabels is on, but the brief's flow selects
    // explicitly to match how a real user would reveal it).
    await expectOverlayCount(page, 1, SPAWN_TIMEOUT_MS);
    const [agentId] = await readAgentOverlayIds(page);
    expect(agentId).toBeDefined();
    await selectCharacter(page, agentId!);

    await expect(getAgentOverlays(page).filter({ hasText: tabLabel })).toHaveCount(1, {
      timeout: SPAWN_TIMEOUT_MS,
    });
  });

  test('pty crash marks the character and restart clears it @area:standalone', async ({
    page,
    standalone,
  }) => {
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('crash-restart').exitAt(3_000, 1),
    );
    await spawnFromForm(page);
    await expect(page.getByTestId('terminal-band')).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });

    // Non-zero exit → server broadcasts ptyExit AND agentCrashed.
    await expect
      .poll(async () => (await getCrashedCharacters(page)).map((ch) => ch.crashed), {
        timeout: SPAWN_TIMEOUT_MS,
        message: 'pty crash (non-zero exit) should mark the character crashed',
      })
      .toEqual([true]);

    const restart = page.getByRole('button', { name: 'Restart agent' });
    await expect(restart).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });
    await restart.click();

    // agentRestarted clears crashed (and, with it, the ack latch).
    await expect
      .poll(async () => (await getCrashedCharacters(page)).map((ch) => ch.crashed), {
        timeout: SPAWN_TIMEOUT_MS,
        message: 'restart should clear the crashed flag',
      })
      .toEqual([false]);
  });

  test('reload re-glyphs a crashed agent @area:standalone', async ({ page, standalone }) => {
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('crash-reload').exitAt(3_000, 1),
    );
    await spawnFromForm(page);
    await expect(page.getByTestId('terminal-band')).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });

    await expect
      .poll(async () => (await getCrashedCharacters(page)).map((ch) => ch.crashed), {
        timeout: SPAWN_TIMEOUT_MS,
        message: 'pty crash (non-zero exit) should mark the character crashed',
      })
      .toEqual([true]);

    // Full page reload: webviewReady → existingAgents (carrying
    // crashedAgentIds) → layoutLoaded. The dead pty worker is retained
    // server-side, so the reloaded page re-derives the same crashed state
    // from scratch rather than inheriting in-memory OfficeState.
    await page.reload();
    await expect(page.getByTestId('terminal-band')).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });

    await expect
      .poll(
        async () =>
          (await getCrashedCharacters(page)).map((ch) => ({
            crashed: ch.crashed,
            crashedAcknowledged: ch.crashedAcknowledged,
          })),
        {
          timeout: SPAWN_TIMEOUT_MS,
          message: 'reload should re-apply the crash glyph via crashedAgentIds, unacknowledged',
        },
      )
      .toEqual([{ crashed: true, crashedAcknowledged: false }]);
  });
});

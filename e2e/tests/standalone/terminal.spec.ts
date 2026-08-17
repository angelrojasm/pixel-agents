import fs from 'node:fs';

import { expect, test } from '../../fixtures/standalone';
import { arrangeNextClaudeInvocation, claudeScenario } from '../../helpers/mock-claude';
import { expectOverlayCount } from '../../helpers/office';
import type { RecordedServerMessage } from '../../helpers/standalone';
import { setSettings } from '../../helpers/webview';

// A pty spawn goes shell -l -c → mock claude → invocation log; give the whole
// chain (plus xterm mount + scrollback replay) generous slack.
const SPAWN_TIMEOUT_MS = 20_000;

async function readFileWhenNonEmpty(filePath: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.trim().length > 0) return content;
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for non-empty ${filePath}`);
}

/** Open the New-agent form and submit it with whatever fields are filled. */
async function spawnFromForm(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: '+ Agent' }).click();
  await expect(page.getByRole('dialog', { name: 'New agent' })).toBeVisible();
  await page.getByRole('button', { name: 'Spawn' }).click();
}

test.describe('Standalone / Terminal band', () => {
  test('+ Agent spawns a pty agent: character, band, mock invocation @area:terminal', async ({
    page,
    standalone,
  }) => {
    // Overlays only render for hovered/selected agents unless labels are on.
    await setSettings(page, { alwaysShowLabels: true });
    await spawnFromForm(page);

    // Character appears in the office.
    await expectOverlayCount(page, 1, SPAWN_TIMEOUT_MS);

    // Terminal band appears with the agent's rail entry.
    await expect(page.getByTestId('terminal-band')).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });
    await expect(page.getByRole('tab')).toHaveCount(1);

    // The MOCK claude answered the spawn — not a real CLI. The login shell can
    // reorder PATH, so the invocation log is the authoritative proof.
    const log = await readFileWhenNonEmpty(standalone.mockLogFile, SPAWN_TIMEOUT_MS);
    expect(log).toContain('session-id=');
  });

  test('typed keystrokes reach the pty and echo back @area:terminal', async ({
    page,
    standalone,
  }) => {
    await spawnFromForm(page);
    await expect(page.getByTestId('terminal-band')).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });
    await readFileWhenNonEmpty(standalone.mockLogFile, SPAWN_TIMEOUT_MS);

    // Focus the xterm pane and type. The mock does not read stdin, but the tty
    // line discipline echoes typed input — so the keystroke round-trips as a
    // ptyData frame if and only if ptyInput reached the server-side pty.
    await standalone.drainMessages();
    await page.locator('[data-testid="terminal-band"] .xterm').click();
    await page.keyboard.type('marker-echo-xyz');

    await expect
      .poll(
        async () => {
          const messages: RecordedServerMessage[] = await standalone.drainMessages();
          return messages
            .filter((m) => m.type === 'ptyData')
            .map((m) => String(m['data'] ?? ''))
            .join('');
        },
        { timeout: SPAWN_TIMEOUT_MS, message: 'typed keystrokes should echo back as ptyData' },
      )
      .toContain('marker-echo-xyz');
  });

  test('pty exit shows the Restart control and restart re-invokes claude @area:terminal', async ({
    page,
    standalone,
  }) => {
    // First spawn claims this scenario: session ends (code 0) shortly after
    // start, while the pane is already mounted (single agent → auto-focused).
    await arrangeNextClaudeInvocation(
      standalone.tmpHome,
      claudeScenario('exit-early').exitAt(3_000, 0),
    );
    await spawnFromForm(page);
    await expect(page.getByTestId('terminal-band')).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });
    const firstLog = await readFileWhenNonEmpty(standalone.mockLogFile, SPAWN_TIMEOUT_MS);
    const firstInvocations = firstLog.trim().split('\n').length;

    // The scenario exits ~3s in → exit marker + Restart button.
    const restart = page.getByRole('button', { name: 'Restart agent' });
    await expect(restart).toBeVisible({ timeout: SPAWN_TIMEOUT_MS });

    // Restart relaunches the SAME session in the same cwd: the button clears
    // and mock-claude logs a second invocation.
    await restart.click();
    await expect(restart).toBeHidden({ timeout: SPAWN_TIMEOUT_MS });
    await expect
      .poll(
        () => {
          try {
            return fs.readFileSync(standalone.mockLogFile, 'utf8').trim().split('\n').length;
          } catch {
            return 0;
          }
        },
        { timeout: SPAWN_TIMEOUT_MS, message: 'restart should log a second mock invocation' },
      )
      .toBeGreaterThan(firstInvocations);
  });
});

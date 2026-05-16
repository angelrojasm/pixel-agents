import * as fs from 'node:fs';
import * as path from 'node:path';

export const HOOK_SCRIPT_VERSION = '3';

export function ensureHookScript(opts: { home: string; bundledPath: string }): void {
  const destDir = path.join(opts.home, '.pixel-agents', 'hooks');
  const destFile = path.join(destDir, 'claude-hook.js');
  fs.mkdirSync(destDir, { recursive: true });
  const bundled = fs.readFileSync(opts.bundledPath, 'utf-8');
  const want = `version: ${HOOK_SCRIPT_VERSION}`;
  if (fs.existsSync(destFile)) {
    const existing = fs.readFileSync(destFile, 'utf-8');
    if (existing.includes(want)) return;
  }
  fs.writeFileSync(destFile, bundled, { mode: 0o755 });
}

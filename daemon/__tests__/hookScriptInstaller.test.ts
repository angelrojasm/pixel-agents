import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ensureHookScript, HOOK_SCRIPT_VERSION } from '../hookScriptInstaller.js';

let tmpHome: string;
let bundled: string;
let dest: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'px-hook-'));
  bundled = path.join(tmpHome, 'bundled-claude-hook.js');
  dest = path.join(tmpHome, '.pixel-agents', 'hooks', 'claude-hook.js');

  fs.writeFileSync(bundled, `// version: ${HOOK_SCRIPT_VERSION}\nconsole.log('hi');`);
  try {
    fs.rmSync(path.dirname(dest), { recursive: true });
  } catch {
    /* */
  }
});

describe('ensureHookScript', () => {
  it('writes the script when missing', () => {
    ensureHookScript({ home: tmpHome, bundledPath: bundled });
    expect(fs.existsSync(dest)).toBe(true);
  });

  it('overwrites when version mismatched', () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, '// version: 0\nold content');
    ensureHookScript({ home: tmpHome, bundledPath: bundled });
    expect(fs.readFileSync(dest, 'utf-8')).toContain(`version: ${HOOK_SCRIPT_VERSION}`);
  });

  it('leaves the script alone when versions match', () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `// version: ${HOOK_SCRIPT_VERSION}\nuser-edited content`);
    ensureHookScript({ home: tmpHome, bundledPath: bundled });
    expect(fs.readFileSync(dest, 'utf-8')).toContain('user-edited content');
  });
});
